import AppKit
import AVFoundation
import Foundation

final class SoundCheck {
    var recorder: AVAudioRecorder?
    let output: URL
    let duration: Double
    let status: URL
    init(output: URL, duration: Double) {
        self.output = output
        self.duration = duration
        self.status = output.deletingPathExtension().appendingPathExtension("status.json")
    }
    func report(_ state: String, extra: [String:Any] = [:]) {
        var body = extra
        body["state"] = state
        body["epoch"] = Date().timeIntervalSince1970
        if let data = try? JSONSerialization.data(withJSONObject:body, options:.prettyPrinted) {
            try? data.write(to:status, options:.atomic)
            try? FileManager.default.setAttributes([.posixPermissions:0o600], ofItemAtPath:status.path)
        }
    }
    func start() {
        report("requesting_microphone_permission")
        AVCaptureDevice.requestAccess(for:.audio) { allowed in
            DispatchQueue.main.async {
                guard allowed else {
                    self.report("microphone_denied")
                    NSApp.terminate(nil)
                    return
                }
                self.record()
            }
        }
    }
    func record() {
        do {
            let name = AVCaptureDevice.default(for:.audio)?.localizedName ?? "unavailable"
            guard name.contains("MacBook Pro Microphone") else {
                report("wrong_microphone",extra:["microphone":name])
                NSApp.terminate(nil)
                return
            }
            let settings:[String:Any] = [AVFormatIDKey:kAudioFormatLinearPCM,
                AVSampleRateKey:24000, AVNumberOfChannelsKey:1, AVLinearPCMBitDepthKey:16,
                AVLinearPCMIsFloatKey:false, AVLinearPCMIsBigEndianKey:false]
            let recorder = try AVAudioRecorder(url:output, settings:settings)
            self.recorder = recorder
            recorder.prepareToRecord()
            guard recorder.record(forDuration:duration) else {
                report("recording_failed");NSApp.terminate(nil);return
            }
            let started = Date().timeIntervalSince1970
            report("recording",extra:["started_epoch":started,"microphone":name,"duration":duration])
            DispatchQueue.main.asyncAfter(deadline:.now()+duration+0.1) {
                recorder.stop()
                try? FileManager.default.setAttributes([.posixPermissions:0o600], ofItemAtPath:self.output.path)
                self.report("complete",extra:["started_epoch":started,"microphone":name,"duration":self.duration])
                NSApp.terminate(nil)
            }
        } catch {
            report("recording_error")
            NSApp.terminate(nil)
        }
    }
}

let args = CommandLine.arguments
let app = NSApplication.shared
app.setActivationPolicy(.accessory)
guard args.count == 3, let seconds = Double(args[2]), seconds >= 1, seconds <= 15 else { exit(2) }
let output = URL(fileURLWithPath:args[1]).standardizedFileURL
let home = FileManager.default.homeDirectoryForCurrentUser.path + "/.config/hue-calibration/"
guard output.path.hasPrefix(home), output.pathExtension == "wav" else { exit(2) }
let check = SoundCheck(output:output,duration:seconds)
DispatchQueue.main.async { check.start() }
app.run()
