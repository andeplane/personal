import AppKit
import AVFoundation

final class FlashCheck: NSObject, NSApplicationDelegate, AVCaptureFileOutputRecordingDelegate {
    let session = AVCaptureSession()
    let movie = AVCaptureMovieFileOutput()
    let root = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".config/hue-calibration/m4-flash-check")
    var window: NSWindow!
    var label: NSTextField!
    var recordButton: NSButton!
    var timer: Timer?
    var started: Double = 0
    func report(_ state: String, extra: [String:Any] = [:]) {
        var body = extra
        body["state"] = state; body["epoch"] = Date().timeIntervalSince1970
        if let data = try? JSONSerialization.data(withJSONObject:body, options:.prettyPrinted) {
            try? data.write(to:root.appendingPathComponent("status.json"),options:.atomic)
        }
        label?.stringValue = state.replacingOccurrences(of:"_",with:" ")
    }
    func applicationDidFinishLaunching(_ notification: Notification) {
        try? FileManager.default.createDirectory(at:root,withIntermediateDirectories:true,attributes:[.posixPermissions:0o700])
        window = NSWindow(contentRect:NSRect(x:0,y:0,width:720,height:490),styleMask:[.titled,.closable],backing:.buffered,defer:false)
        window.title = "Hue Camera & Mic Check";window.center()
        let view=NSView(frame:NSRect(x:0,y:0,width:720,height:490));view.wantsLayer=true
        window.contentView=view
        label=NSTextField(labelWithString:"Requesting camera and microphone access…")
        label.frame=NSRect(x:20,y:16,width:450,height:26);view.addSubview(label)
        recordButton=NSButton(title:"Record 60 seconds",target:self,action:#selector(record))
        recordButton.frame=NSRect(x:490,y:12,width:210,height:32);recordButton.isEnabled=false;view.addSubview(recordButton)
        window.makeKeyAndOrderFront(nil);NSApp.activate(ignoringOtherApps:true)
        report("requesting_camera")
        AVCaptureDevice.requestAccess(for:.video) { video in
            AVCaptureDevice.requestAccess(for:.audio) { audio in
                DispatchQueue.main.async {
                    guard video && audio else {
                        self.report("permission_required",extra:["camera_allowed":video,"microphone_allowed":audio]);return
                    }
                    self.configure()
                }
            }
        }
        DispatchQueue.main.asyncAfter(deadline:.now()+180) { if !self.movie.isRecording { self.session.stopRunning();NSApp.terminate(nil) } }
    }
    func configure() {
        do {
            guard let camera=AVCaptureDevice.DiscoverySession(deviceTypes:[.builtInWideAngleCamera],mediaType:.video,position:.unspecified).devices.first,
                  let microphone=AVCaptureDevice.default(for:.audio) else { report("device_unavailable");return }
            guard microphone.localizedName.contains("MacBook Pro Microphone") else { report("select_MacBook_microphone");return }
            session.beginConfiguration();session.sessionPreset = .hd1280x720
            for device in [camera,microphone] {
                let input=try AVCaptureDeviceInput(device:device)
                guard session.canAddInput(input) else { throw NSError(domain:"capture",code:1) }
                session.addInput(input)
            }
            guard session.canAddOutput(movie) else { throw NSError(domain:"capture",code:2) }
            session.addOutput(movie);session.commitConfiguration()
            let preview=AVCaptureVideoPreviewLayer(session:session)
            preview.frame=CGRect(x:0,y:58,width:720,height:432);preview.videoGravity = .resizeAspect
            window.contentView!.layer!.addSublayer(preview)
            DispatchQueue.global(qos:.userInitiated).async {
                self.session.startRunning()
                DispatchQueue.main.async {
                    self.report("preview_ready",extra:["camera":camera.localizedName,"microphone":microphone.localizedName])
                    self.recordButton.isEnabled=true
                    self.timer=Timer.scheduledTimer(withTimeInterval:0.5,repeats:true) { _ in
                        let request=self.root.appendingPathComponent("capture.request")
                        if FileManager.default.fileExists(atPath:request.path) { try? FileManager.default.removeItem(at:request);self.record() }
                    }
                }
            }
        } catch { report("capture_setup_failed") }
    }
    @objc func record() {
        guard session.isRunning && !movie.isRecording else { return }
        recordButton.isEnabled=false;timer?.invalidate()
        let file=root.appendingPathComponent("capture-\(Int(Date().timeIntervalSince1970)).mov")
        movie.startRecording(to:file,recordingDelegate:self)
    }
    func fileOutput(_ output: AVCaptureFileOutput,didStartRecordingTo fileURL:URL,from connections:[AVCaptureConnection]) {
        DispatchQueue.main.async {
            self.started=Date().timeIntervalSince1970
            self.report("recording",extra:["started_epoch":self.started,"file":fileURL.path])
            DispatchQueue.main.asyncAfter(deadline:.now()+60) { if self.movie.isRecording { self.movie.stopRecording() } }
        }
    }
    func fileOutput(_ output:AVCaptureFileOutput,didFinishRecordingTo fileURL:URL,from connections:[AVCaptureConnection],error:Error?) {
        DispatchQueue.main.async {
            try? FileManager.default.setAttributes([.posixPermissions:0o600],ofItemAtPath:fileURL.path)
            self.session.stopRunning()
            self.report(error == nil ? "complete":"recording_error",extra:["started_epoch":self.started,"file":fileURL.path])
            NSApp.terminate(nil)
        }
    }
    func applicationWillTerminate(_ notification:Notification) { timer?.invalidate();if movie.isRecording { movie.stopRecording() };session.stopRunning() }
}
let app=NSApplication.shared
let delegate=FlashCheck()
app.setActivationPolicy(.regular);app.delegate=delegate;app.run()
