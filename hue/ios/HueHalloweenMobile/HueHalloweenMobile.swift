import SwiftUI
import Foundation
import CryptoKit
import Security

private struct ClientConfiguration: Decodable {
    let baseURL: URL
    let token: String
    let certificateSHA256: String
    enum CodingKeys: String, CodingKey {
        case baseURL = "base_url", token, certificateSHA256 = "certificate_sha256"
    }
    static func load() throws -> Self {
        guard let file = Bundle.main.url(forResource:"client",withExtension:"json") else { throw ControlError.notPaired }
        let config = try JSONDecoder().decode(Self.self,from:Data(contentsOf:file))
        let pin = config.certificateSHA256.lowercased()
        guard config.baseURL.scheme == "https", config.baseURL.host != nil,
              config.baseURL.user == nil, config.baseURL.password == nil,
              pin.count == 64, pin.allSatisfy({$0.isHexDigit}),
              config.token.count >= 16, !config.token.contains(where:{$0.isNewline}) else { throw ControlError.notPaired }
        return config
    }
}

private enum ControlError: LocalizedError {
    case notPaired, identityChanged, unauthorized, invalidReply, unreachable, rejected(String)
    var errorDescription: String? {
        switch self {
        case .notPaired: return "This app has not been paired with your home controller."
        case .identityChanged: return "The controller’s certificate does not match this app’s pairing. Connection blocked."
        case .unauthorized: return "The controller rejected this app’s access. Pair the app again."
        case .invalidReply: return "The controller returned an unexpected response."
        case .unreachable: return "Can’t reach the home controller. Connect the iPhone to your home Wi-Fi."
        case .rejected(let message): return message
        }
    }
}

private final class PinnedConnection: NSObject, URLSessionDelegate, URLSessionTaskDelegate, @unchecked Sendable {
    let host: String
    let port: Int
    let expectedPin: String
    private let lock = NSLock()
    private var rejectedAt: Date?
    init(configuration: ClientConfiguration) {
        host = configuration.baseURL.host!.lowercased()
        port = configuration.baseURL.port ?? 443
        expectedPin = configuration.certificateSHA256.lowercased()
    }
    var recentlyRejected: Bool {
        lock.lock(); defer { lock.unlock() }
        return rejectedAt.map { Date().timeIntervalSince($0) < 10 } ?? false
    }
    func urlSession(_ session: URLSession, didReceive challenge: URLAuthenticationChallenge,
                    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
              challenge.protectionSpace.host.lowercased() == host,
              challenge.protectionSpace.port == port,
              let trust = challenge.protectionSpace.serverTrust,
              let chain = SecTrustCopyCertificateChain(trust) as? [SecCertificate], let leaf = chain.first else {
            completionHandler(.cancelAuthenticationChallenge,nil);return
        }
        let actual = SHA256.hash(data:SecCertificateCopyData(leaf) as Data).map { String(format:"%02x",$0) }.joined()
        guard actual == expectedPin else {
            lock.lock();rejectedAt = Date();lock.unlock()
            completionHandler(.cancelAuthenticationChallenge,nil);return
        }
        // This exact private certificate is the trust anchor established during
        // pairing. No other self-signed or system-trusted certificate is accepted.
        completionHandler(.useCredential,URLCredential(trust:trust))
    }
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        // Never forward the bearer token to a redirect destination.
        completionHandler(nil)
    }
}

private struct ActivityRecord: Decodable, Identifiable {
    let id: Int
    let at: String
    let kind: String
    let message: String
    let source: String?
    var date: Date? {
        let fractional = ISO8601DateFormatter();fractional.formatOptions = [.withInternetDateTime,.withFractionalSeconds]
        return fractional.date(from:at) ?? ISO8601DateFormatter().date(from:at)
    }
    var icon: String {
        let text = (kind + " " + message).lowercased()
        if kind == "motion" { return text.contains("clear") ? "figure.stand" : "figure.walk.motion" }
        if text.contains("fail") { return "exclamationmark.triangle.fill" }
        if text.contains("finish") || text.contains("complet") { return "checkmark.circle.fill" }
        if text.contains("stop") { return "stop.circle" }
        if text.contains("skip") { return "arrow.uturn.right.circle" }
        if text.contains("start") { return "play.circle.fill" }
        return "clock"
    }
}

private struct ControlReply: Decodable {
    let ok: Bool
    let state: String?
    let phase: String?
    let motionArmed: Bool?
    let requestedMotionArmed: Bool?
    let message: String?
    let audioError: String?
    let activity: [ActivityRecord]?
    let activityMore: Bool?
    let activityError: String?
    enum CodingKeys: String, CodingKey {
        case ok, state, phase, message, activity
        case motionArmed = "motion_armed", requestedMotionArmed = "requested_motion_armed"
        case audioError = "audio_error", activityMore = "activity_more", activityError = "activity_error"
    }
}

private struct ControlCommand: Encodable {
    let action: String
    var enabled: Bool? = nil
    var before: Int? = nil
}

private final class ControlClient: @unchecked Sendable {
    private let configuration: ClientConfiguration
    private let delegate: PinnedConnection
    private let session: URLSession
    init(configuration: ClientConfiguration) {
        self.configuration = configuration
        delegate = PinnedConnection(configuration:configuration)
        let settings = URLSessionConfiguration.ephemeral
        settings.httpShouldSetCookies = false
        settings.httpCookieStorage = nil
        settings.urlCredentialStorage = nil
        settings.requestCachePolicy = .reloadIgnoringLocalCacheData
        settings.timeoutIntervalForRequest = 6
        settings.timeoutIntervalForResource = 10
        session = URLSession(configuration:settings,delegate:delegate,delegateQueue:nil)
    }
    func send(_ command: ControlCommand) async throws -> ControlReply {
        var request = URLRequest(url:configuration.baseURL.appendingPathComponent("control"))
        request.httpMethod = "POST"
        request.setValue("application/json",forHTTPHeaderField:"Content-Type")
        request.setValue("application/json",forHTTPHeaderField:"Accept")
        request.setValue("ios",forHTTPHeaderField:"X-Hue-Client")
        request.setValue("Bearer " + configuration.token,forHTTPHeaderField:"Authorization")
        request.httpBody = try JSONEncoder().encode(command)
        do {
            let (data,response) = try await session.data(for:request)
            guard let http = response as? HTTPURLResponse else { throw ControlError.invalidReply }
            if http.statusCode == 401 || http.statusCode == 403 { throw ControlError.unauthorized }
            guard http.statusCode == 200, data.count < 524288 else { throw ControlError.invalidReply }
            let reply = try JSONDecoder().decode(ControlReply.self,from:data)
            guard reply.ok else { throw ControlError.rejected(reply.message ?? "The controller couldn’t complete that action.") }
            return reply
        } catch let error as ControlError { throw error }
        catch is CancellationError { throw CancellationError() }
        catch {
            if Task.isCancelled { throw CancellationError() }
            throw delegate.recentlyRejected ? ControlError.identityChanged : ControlError.unreachable
        }
    }
}

@MainActor private final class Controls: ObservableObject {
    @Published var connected = false
    @Published var paired = false
    @Published var motionArmed = false
    @Published var motionChanging = false
    @Published var pending: Set<String> = []
    @Published var state = "Connecting…"
    @Published var running = false
    @Published var errorMessage = ""
    @Published var speakerWarning = ""
    @Published var loggingWarning = ""
    @Published var activity: [ActivityRecord] = []
    @Published var activityMore = false
    @Published var loadingOlder = false
    @Published var activityMessage = ""
    @Published var lastUpdated: Date?
    private var client: ControlClient?
    private var refreshInProgress = false
    private var generation = 0
    private var paginationInitialized = false
    private var activityRevision = 0
    init() {
        do { client = ControlClient(configuration:try ClientConfiguration.load());paired = true }
        catch { state = "Pairing required";errorMessage = error.localizedDescription }
    }
    var motionDescription: String {
        if motionChanging { return "Updating motion detection…" }
        if !connected { return "Waiting for the home controller" }
        return motionArmed ? "Motion can start the horror scene" : "Automatic scene starts are paused"
    }
    func poll() async {
        guard paired else { return }
        while !Task.isCancelled {
            await refresh()
            do { try await Task.sleep(for:.seconds(2)) } catch { return }
        }
    }
    func refresh() async {
        guard !refreshInProgress, let client = client else { return }
        refreshInProgress = true
        let requestedGeneration = generation
        defer { refreshInProgress = false }
        do {
            let reply = try await client.send(ControlCommand(action:"library"))
            mergeActivity(reply)
            if requestedGeneration == generation { apply(reply);errorMessage = "" }
        } catch is CancellationError { }
        catch {
            if requestedGeneration == generation { connected = false;errorMessage = error.localizedDescription }
        }
    }
    func command(_ action: String, enabled: Bool? = nil) {
        guard let client = client, !pending.contains(action) else { return }
        generation += 1
        let requestedGeneration = generation
        pending.insert(action)
        errorMessage = ""
        Task {
            defer { self.pending.remove(action) }
            do {
                let reply = try await client.send(ControlCommand(action:action,enabled:enabled))
                self.mergeActivity(reply)
                if requestedGeneration == self.generation { self.apply(reply) }
            } catch is CancellationError { }
            catch {
                if requestedGeneration == self.generation { self.errorMessage = error.localizedDescription }
            }
        }
    }
    func loadOlder() {
        guard let client = client, let oldest = activity.last?.id, activityMore, !loadingOlder else { return }
        loadingOlder = true;activityMessage = ""
        let requestedRevision = activityRevision
        Task {
            defer { self.loadingOlder = false }
            do {
                let reply = try await client.send(ControlCommand(action:"events",before:oldest))
                guard requestedRevision == self.activityRevision else { return }
                self.merge(reply.activity ?? [])
                self.activityMore = reply.activityMore ?? false
            } catch { self.activityMessage = "Couldn’t load older activity. Try again." }
        }
    }
    private func merge(_ records: [ActivityRecord]) {
        var indexed = Dictionary(uniqueKeysWithValues:activity.map { ($0.id,$0) })
        for record in records { indexed[record.id] = record }
        activity = indexed.values.sorted { $0.id > $1.id }
    }
    private func mergeActivity(_ reply: ControlReply) {
        guard let records = reply.activity else { return }
        if let previousNewest = activity.first?.id, let incomingOldest = records.map(\.id).min(),
           incomingOldest > previousNewest + 1, reply.activityMore == true {
            // After a long background period, show a contiguous latest page.
            // Older records remain reachable by paging from its oldest ID.
            activity = records.sorted { $0.id > $1.id }
            activityMore = true
            paginationInitialized = true
            activityRevision += 1
            activityMessage = "Activity was recorded while the app was away. Load older to see the complete history."
            return
        }
        if !paginationInitialized { activityMore = reply.activityMore ?? false;paginationInitialized = true }
        merge(records)
    }
    private func apply(_ reply: ControlReply) {
        connected = true;lastUpdated = Date()
        if let armed = reply.motionArmed { motionArmed = armed }
        motionChanging = reply.requestedMotionArmed != nil
        let raw = reply.state ?? "idle"
        running = ["starting","playing","warming","retrying"].contains(raw)
        let names = ["idle":"Ready · scene lights off", "starting":"Preparing lights…", "playing":"Horror scene running",
                     "stopping":"Stopping · going dark…", "failed":"Scene stopped after a problem", "retrying":"Reconnecting lights…",
                     "reconnecting":"Waiting for the lights…", "lights_on":"Lights on", "warming":"Preparing lights…"]
        state = names[raw] ?? raw.replacingOccurrences(of:"_",with:" ").capitalized
        if raw == "playing" {
            switch reply.phase {
            case "storm": state = "Storm · white & purple lightning"
            case "reveal": state = "Mask reveal · evil laugh"
            case "finale": state = "Final scare · scream & lightning"
            case "aftermath": state = "Aftermath · thunder & surprise scares"
            case "tail": state = "Finishing · fading sound"
            default: break
            }
        }
        speakerWarning = reply.audioError == "speaker_unavailable" ? "Selected Sonos unavailable or busy · lights continue" : ""
        loggingWarning = reply.activityError == "activity_unavailable" ? "Activity logging is unavailable. New events may be missing." : ""
    }
}

private struct ContentView: View {
    @StateObject private var controls = Controls()
    @Environment(\.scenePhase) private var scenePhase
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment:.leading,spacing:20) {
                    VStack(alignment:.leading,spacing:10) {
                        HStack(spacing:14) {
                            VStack(alignment:.leading,spacing:5) {
                                Text("Motion detection").font(.headline)
                                Text(controls.motionDescription).font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer(minLength:4)
                            Toggle("Motion detection",isOn:Binding(get:{controls.motionArmed},set:{controls.command("arm",enabled:$0)}))
                                .labelsHidden().tint(.green).disabled(!controls.connected || controls.pending.contains("arm"))
                            Text(controls.motionArmed ? "ON" : "OFF").font(.headline.monospaced())
                                .foregroundStyle(controls.motionArmed ? Color.green : Color.secondary).frame(width:36)
                        }
                        Text("On enables sensor triggers. Off pauses them. Manual tests pause motion.")
                            .font(.caption2).foregroundStyle(.secondary)
                    }.padding(16)
                        .background(controls.motionArmed ? Color.green.opacity(0.10) : Color.secondary.opacity(0.08),in:RoundedRectangle(cornerRadius:20))
                    HStack(alignment:.top,spacing:12) {
                        Image(systemName:"cloud.bolt.rain.fill").font(.largeTitle).foregroundStyle(.orange)
                        VStack(alignment:.leading,spacing:6) {
                            Text(controls.state).font(.headline)
                            Label(controls.connected ? "Connected to home" : "Not connected",systemImage:controls.connected ? "checkmark.circle.fill":"wifi.slash")
                                .font(.caption).foregroundStyle(controls.connected ? Color.green : Color.secondary)
                        }
                        Spacer()
                        if !controls.pending.isEmpty { ProgressView().controlSize(.small) }
                    }
                    HStack(spacing:12) {
                        Button { controls.command("start") } label: {
                            Label(controls.running ? "Restart full scene" : "Test full scene",systemImage:controls.running ? "arrow.clockwise":"play.fill")
                                .frame(maxWidth:.infinity,minHeight:44)
                        }.buttonStyle(.borderedProminent).tint(.orange)
                            .disabled(!controls.paired || controls.pending.contains("start"))
                        Button { controls.command("stop") } label: {
                            Label("Stop & dark",systemImage:"stop.fill").frame(maxWidth:.infinity,minHeight:44)
                        }.buttonStyle(.borderedProminent).tint(.red)
                            .disabled(!controls.paired || controls.pending.contains("stop"))
                    }
                    if !controls.errorMessage.isEmpty { warning(controls.errorMessage,icon:"wifi.exclamationmark") }
                    if !controls.speakerWarning.isEmpty { warning(controls.speakerWarning,icon:"speaker.slash.fill") }
                    if !controls.loggingWarning.isEmpty { warning(controls.loggingWarning,icon:"exclamationmark.triangle.fill") }
                    Divider()
                    HStack {
                        Text("Activity").font(.title2.bold())
                        Spacer()
                        Text("\(controls.activity.count) loaded").font(.caption).foregroundStyle(.secondary)
                    }
                    Text("Newest first · local time. History starts when logging was enabled.")
                        .font(.caption).foregroundStyle(.secondary)
                    LazyVStack(alignment:.leading,spacing:0) {
                        if controls.activity.isEmpty {
                            ContentUnavailableView("No activity yet",systemImage:"clock",description:Text("Motion detections and scene starts, finishes and stops appear here."))
                                .padding(.vertical,12)
                        }
                        ForEach(controls.activity) { record in
                            HStack(alignment:.top,spacing:12) {
                                Image(systemName:record.icon).foregroundStyle(.orange).frame(width:20).padding(.top,2)
                                VStack(alignment:.leading,spacing:5) {
                                    if let date = record.date {
                                        Text(date,format:.dateTime.day().month(.abbreviated).hour().minute().second())
                                            .font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                                    }
                                    Text(record.message).font(.subheadline).textSelection(.enabled)
                                    if let source = record.source { Text(source.capitalized).font(.caption2).foregroundStyle(.secondary) }
                                }
                                Spacer(minLength:0)
                            }.padding(.vertical,12)
                            Divider()
                        }
                    }
                    if !controls.activityMessage.isEmpty { warning(controls.activityMessage,icon:"clock.badge.exclamationmark") }
                    if controls.activityMore {
                        Button { controls.loadOlder() } label: {
                            HStack { if controls.loadingOlder { ProgressView() };Text("Load older activity") }.frame(maxWidth:.infinity,minHeight:36)
                        }.buttonStyle(.bordered).disabled(controls.loadingOlder || !controls.connected)
                    } else if !controls.activity.isEmpty {
                        Text("Beginning of recorded history loaded").font(.caption2).foregroundStyle(.secondary)
                    }
                    Text("Purple/white lightning · warm mask reveal").font(.caption2).foregroundStyle(.secondary)
                }.padding(20)
            }.refreshable { await controls.refresh() }
                .navigationTitle("Hue Halloween")
                .background(Color(uiColor:.systemGroupedBackground))
        }.task(id:scenePhase) { if scenePhase == .active { await controls.poll() } }
    }
    private func warning(_ text: String, icon: String) -> some View {
        Label(text,systemImage:icon).font(.footnote).foregroundStyle(.orange)
            .frame(maxWidth:.infinity,alignment:.leading)
    }
}

@main struct HueHalloweenMobileApp: App {
    var body: some Scene { WindowGroup { ContentView() } }
}
