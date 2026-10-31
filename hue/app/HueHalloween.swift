import SwiftUI
import AppKit
import Combine

struct SoundClip: Decodable, Identifiable {
    let id: String
    let name: String
    let category: String
    let duration: Double
}

private struct ControlReply: Decodable {
    let ok: Bool
    let state: String?
    let motionArmed: Bool?
    let requestedMotionArmed: Bool?
    let audioState: String?
    let audioError: String?
    let volume: Double?
    let message: String?
    let clips: [SoundClip]?
    let phase: String?
    let lastError: String?
    enum CodingKeys: String, CodingKey {
        case ok, state, volume, message, clips, phase
        case motionArmed = "motion_armed"
        case requestedMotionArmed = "requested_motion_armed"
        case audioState = "audio_state"
        case audioError = "audio_error"
        case lastError = "last_error"
    }
}

@MainActor final class Controls: ObservableObject {
    @Published var connected = false
    @Published var busy = false
    @Published var pendingActions: Set<String> = []
    @Published var armed = false
    @Published var sequenceActive = false
    @Published var previewState = ""
    @Published var motionChanging = false
    @Published var state = "Connecting…"
    @Published var volume = 50.0
    @Published var message = ""
    @Published var clips: [SoundClip] = []
    @Published var selected: [String] = UserDefaults.standard.stringArray(forKey:"selectedSounds") ?? []
    @Published var mixMode = UserDefaults.standard.string(forKey:"mixMode") ?? "together"
    var editingVolume = false
    private var refreshing = false
    private var generation = 0
    private var connectionIssue = false
    private var actionTokens: [String:Int] = [:]

    func canSend(_ action: String) -> Bool {
        connected && (action == "stop" || !pendingActions.contains(action))
    }

    var selectionDescription: String {
        let names = selected.compactMap { id in clips.first(where:{$0.id == id})?.name }
        return names.isEmpty ? "Choose up to four sounds, then play the mix." : names.joined(separator:mixMode == "sequence" ? " → " : " + ")
    }

    func select(_ id: String, enabled: Bool) {
        if enabled {
            guard selected.count < 4, !selected.contains(id) else { return }
            selected.append(id)
        } else { selected.removeAll(where:{$0 == id}) }
        saveSelection()
    }

    private func saveSelection() {
        UserDefaults.standard.set(selected,forKey:"selectedSounds")
    }

    func setMixMode(_ value: String) {
        mixMode = value
        UserDefaults.standard.set(value,forKey:"mixMode")
    }

    func playSelection() {
        command("play",value:mixMode + ":" + selected.joined(separator:","))
    }

    private nonisolated static func request(_ action: String, value: String?) -> Data {
        let actions: Set<String> = ["library","status","arm","start","stop","flash","thunder","on","off","volume","play"]
        guard actions.contains(action) else { return Data() }
        let process = Process()
        process.executableURL = URL(fileURLWithPath:"/usr/bin/ssh")
        var remote = "\"$HOME/.config/hue-halloween/venv/bin/python\" \"$HOME/.config/hue-halloween/runtime/control.py\" " + action
        if let value = value {
            let allowed = CharacterSet(charactersIn:"abcdefghijklmnopqrstuvwxyz0123456789-:,")
            guard !value.isEmpty, value.unicodeScalars.allSatisfy({allowed.contains($0)}) else { return Data() }
            remote += " " + value
        }
        process.arguments = ["-o","BatchMode=yes","-o","ConnectTimeout=4",
            "-o","ServerAliveInterval=5","-o","ServerAliveCountMax=1","home-mini",remote]
        let output = Pipe()
        process.standardOutput = output
        process.standardError = FileHandle.nullDevice
        do {
            try process.run()
            let data = output.fileHandleForReading.readDataToEndOfFile()
            process.waitUntilExit()
            return data
        } catch { return Data() }
    }

    func command(_ action: String, value: String? = nil, quiet: Bool = false) {
        if quiet {
            guard !refreshing && !busy else { return }
            refreshing = true
        } else {
            // Coalesce only duplicate requests. Volume or a preview must not
            // disable unrelated lighting controls; Stop always has priority.
            guard !pendingActions.contains(action) else { return }
            generation += 1
            pendingActions.insert(action)
            actionTokens[action] = generation
            busy = true
            message = ""
            switch action {
            case "start":
                state = sequenceActive ? "Restarting sequence…" : "Starting sequence…"
                sequenceActive = true; armed = false
            case "flash":
                state = "Starting lightning test…"; sequenceActive = true; armed = false
            case "stop", "off":
                state = "Stopping · lights going dark…"; sequenceActive = false; armed = false
                previewState = ""
            case "on":
                state = "Turning yellow lights on…"; sequenceActive = false; armed = false
            case "play", "thunder":
                previewState = "Preparing sound…"; armed = false
            case "arm":
                armed = value == "on"; motionChanging = true
            default: break
            }
        }
        let requestedGeneration = generation
        Task {
            let result = await Task.detached(priority:.userInitiated) { Self.request(action,value:value) }.value
            if quiet { self.refreshing = false }
            if !quiet && self.actionTokens[action] == requestedGeneration {
                self.pendingActions.remove(action)
                self.actionTokens.removeValue(forKey:action)
                self.busy = !self.pendingActions.isEmpty
            }
            // A late refresh/start response must not overwrite a newer Stop.
            guard requestedGeneration == self.generation else { return }
            guard let body = try? JSONDecoder().decode(ControlReply.self,from:result) else {
                self.connected = false
                self.connectionIssue = true
                self.state = "Controller unavailable · retrying…"
                self.message = "Can’t reach the Mac mini. The app will reconnect automatically."
                return
            }
            // The SSH client can reply even when the daemon itself is down.
            // Other valid error replies mean the daemon rejected an action.
            self.connected = !(body.message?.hasPrefix("Hue controller unavailable.") ?? false)
            guard body.ok else {
                if !self.connected {
                    self.connectionIssue = true
                    self.state = "Controller unavailable · retrying…"
                }
                self.message = body.message ?? "The controller couldn’t complete that action."
                return
            }
            let names = ["idle":"Idle · lights off", "starting":"Preparing lightning…", "playing":"Storm running",
                         "thunder":"Playing sound", "lights_on":"Yellow lights on", "retrying":"Reconnecting lights…",
                         "reconnecting":"Waiting for the lights…", "failed":"Lighting or sound failed",
                         "skipped":"Another lighting app is active", "warming":"Preparing lightning…",
                         "stopping":"Stopping · lights going dark…"]
            let raw = body.state ?? "idle"
            var label = names[raw] ?? raw.replacingOccurrences(of:"_",with:" ").capitalized
            if raw == "playing" {
                switch body.phase {
                case "normal": label = "Opening · warm yellow"
                case "dark": label = "Opening · brief darkness"
                case "lightning": label = "Storm · white lightning flashes"
                case "steady": label = "Storm · yellow background"
                default: break
                }
            }
            self.state = label
            self.sequenceActive = ["starting","playing","warming","retrying"].contains(raw)
            self.motionChanging = body.requestedMotionArmed != nil
            if let armed = body.requestedMotionArmed ?? body.motionArmed { self.armed = armed }
            switch body.audioState {
            case "preparing": self.previewState = "Preparing sound…"
            case "playing": self.previewState = "Playing sound preview · lights continue"
            case "failed": self.previewState = "Sound preview failed · try another clip"
            default: self.previewState = ""
            }
            if let volume = body.volume, !self.editingVolume { self.volume = volume }
            if let clips = body.clips {
                self.clips = clips
                let available = Set(clips.map(\.id))
                self.selected = self.selected.filter(available.contains)
                self.saveSelection()
            }
            if let error = body.lastError, raw == "failed" {
                self.message = error == "sound_playback_failed" ? "Sonos couldn’t play the sound. You can stop and try another clip." : "The sequence stopped after a connection problem. You can try again."
            } else if !quiet || self.connectionIssue {
                self.message = body.message ?? ""
            }
            self.connectionIssue = false
        }
    }
}

struct ControlView: View {
    @StateObject private var controls = Controls()
    @State private var category = "Thunder"
    let timer = Timer.publish(every:3,on:.main,in:.common).autoconnect()
    private var visibleClips: [SoundClip] {
        controls.clips.filter { category == "Other" ? !["Thunder","Scream"].contains($0.category) : $0.category == category }
    }
    var body: some View {
        VStack(alignment:.leading,spacing:16) {
            HStack(spacing:12) {
                Image(systemName:"cloud.bolt.rain.fill").font(.system(size:34)).foregroundStyle(.orange)
                VStack(alignment:.leading,spacing:3) {
                    Text("Hue Halloween").font(.title2.bold())
                    Text("Motion, lightning & thunder").font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Circle().fill(controls.connected ? .green : .gray).frame(width:9,height:9)
                    .accessibilityLabel(controls.connected ? "Controller connected":"Controller unavailable")
            }
            HStack {
                Text(controls.state).font(.headline)
                Spacer()
                if controls.busy { ProgressView().controlSize(.small) }
            }
            Toggle("Automatic motion",isOn:Binding(get:{controls.armed},set:{controls.command("arm",value:$0 ? "on":"off")}))
                .toggleStyle(.switch).disabled(!controls.canSend("arm"))
            Text(controls.motionChanging ? "Updating automatic motion…" : (controls.armed ? "Motion starts the two-minute sequence." : "Motion paused. Use the buttons to test manually."))
                .font(.caption).foregroundStyle(.secondary)
            Divider()
            HStack {
                Button { controls.command("start") } label: { Label(controls.sequenceActive ? "Restart sequence" : "Start sequence",systemImage:controls.sequenceActive ? "arrow.clockwise" : "play.fill").frame(maxWidth:.infinity) }
                    .buttonStyle(.borderedProminent).tint(.orange).disabled(!controls.canSend("start"))
                Button { controls.command("stop") } label: { Label("Stop & dark",systemImage:"stop.fill").frame(maxWidth:.infinity) }
                    .buttonStyle(.bordered).tint(.red).disabled(!controls.canSend("stop"))
            }.controlSize(.large)
            HStack {
                Button { controls.command("flash") } label: { Label("Lightning",systemImage:"bolt.fill").frame(maxWidth:.infinity) }
                    .disabled(!controls.canSend("flash"))
                Button { controls.command("thunder") } label: { Label("Thunder",systemImage:"speaker.wave.2.fill").frame(maxWidth:.infinity) }
                    .disabled(!controls.canSend("thunder"))
            }.buttonStyle(.bordered).controlSize(.large)
            HStack {
                Button { controls.command("on") } label: { Label("Yellow lights on",systemImage:"lightbulb.fill").frame(maxWidth:.infinity) }
                    .disabled(!controls.canSend("on"))
                Button { controls.command("off") } label: { Label("Lights off",systemImage:"lightbulb.slash").frame(maxWidth:.infinity) }
                    .disabled(!controls.canSend("off"))
            }.buttonStyle(.bordered).controlSize(.large)
            Divider()
            HStack {
                Image(systemName:"speaker.wave.2")
                Slider(value:$controls.volume,in:0...100,step:1,onEditingChanged:{editing in
                    controls.editingVolume = editing
                    if !editing { controls.command("volume",value:String(Int(controls.volume))) }
                }).disabled(!controls.canSend("volume"))
                Text("\(Int(controls.volume))%").monospacedDigit().frame(width:45)
            }
            Divider()
            HStack {
                Text("Sound library").font(.headline)
                Spacer()
                if !controls.previewState.isEmpty {
                    Text(controls.previewState).font(.caption).foregroundStyle(.secondary)
                }
            }
            Picker("Category",selection:$category) {
                Text("Thunder").tag("Thunder")
                Text("Screams").tag("Scream")
                Text("Other").tag("Other")
            }.pickerStyle(.segmented)
            ScrollView {
                VStack(alignment:.leading,spacing:10) {
                    if visibleClips.isEmpty {
                        Text(controls.connected ? "No sounds in this category yet.":"The sound library will load when the controller reconnects.")
                            .font(.caption).foregroundStyle(.secondary).padding(.vertical,12)
                    }
                    ForEach(visibleClips) { clip in
                        HStack {
                            Toggle(clip.name,isOn:Binding(get:{controls.selected.contains(clip.id)},set:{controls.select(clip.id,enabled:$0)}))
                                .toggleStyle(.checkbox)
                                .disabled(!controls.selected.contains(clip.id) && controls.selected.count >= 4)
                            Spacer()
                            Text(String(format:"%.1fs",clip.duration)).font(.caption).foregroundStyle(.secondary)
                            Button { controls.command("play",value:"together:" + clip.id) } label: { Image(systemName:"play.fill") }
                                .help("Play \(clip.name)").accessibilityLabel("Play \(clip.name)")
                                .disabled(!controls.canSend("play"))
                        }
                    }
                }.padding(.trailing,8)
            }.frame(height:180)
            Text(controls.selectionDescription).font(.caption).foregroundStyle(.secondary)
                .lineLimit(2).frame(minHeight:30,alignment:.topLeading)
            HStack {
                Picker("Mix",selection:Binding(get:{controls.mixMode},set:{controls.setMixMode($0)})) {
                    Text("Together").tag("together")
                    Text("One after another").tag("sequence")
                }.labelsHidden()
                Text("\(controls.selected.count)/4").font(.caption).foregroundStyle(.secondary)
                Button("Play selected") { controls.playSelection() }
                    .disabled(controls.selected.isEmpty || !controls.canSend("play"))
            }
            Text(controls.message.isEmpty ? "Manual controls pause motion. Turn Automatic motion back on when ready." : controls.message)
                .font(.caption).foregroundStyle(controls.message.isEmpty ? Color.secondary : Color.orange)
                .fixedSize(horizontal:false,vertical:true)
            HStack {
                Text("Yellow background · brief white lightning").font(.caption2).foregroundStyle(.secondary)
                Spacer()
                Button("Refresh") { controls.command("library") }.buttonStyle(.link).disabled(!controls.canSend("library"))
            }
        }.padding(24).frame(width:480)
            .onAppear { controls.command("library") }
            .onReceive(timer) { _ in controls.command("library",quiet:true) }
    }
}

@main struct HueHalloweenApp: App {
    var body: some Scene {
        WindowGroup { ControlView() }
            .windowResizability(.contentSize)
    }
}
