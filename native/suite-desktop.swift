import AppKit
import ScreenCaptureKit
import CoreMedia
import CoreVideo
import AudioToolbox

// Private pipe protocol: four-byte kind, big-endian byte length, then payload.
// Video is RGBA; audio is stereo signed 16-bit PCM at 48 kHz. Only the selected
// emulator application's window and audio are captured.
private func log(_ text: String) { FileHandle.standardError.write(Data((text+"\n").utf8)) }
private enum Failure: Error { case message(String) }
private func packet(_ kind:String,_ data:Data) {
    var size=UInt32(data.count).bigEndian;var header=Data(kind.utf8)
    withUnsafeBytes(of:&size) { header.append(contentsOf:$0) }
    FileHandle.standardOutput.write(header);FileHandle.standardOutput.write(data)
}
private func permissionStatus() -> [String:Any] {
    let screen=CGPreflightScreenCaptureAccess(),control=AXIsProcessTrusted()
    return ["state":screen ? "running" : "awaiting-permission",
            "permissions":["screenRecording":screen,"accessibility":control],
            "message": !screen ? "macOS is blocking 3DS video. Enable Screen Recording for the requesting app in System Settings → Privacy & Security, then retry video." :
                !control ? "Video is available. Enable Accessibility for the requesting app in System Settings → Privacy & Security to use game controls." : ""]
}
private func sendStatus(_ value:[String:Any]) {
    if let data=try? JSONSerialization.data(withJSONObject:value) { packet("STA1",data) }
}
@MainActor private final class RemoteController {
    let pid:pid_t;var controller:Controller?
    init(pid:pid_t) { self.pid=pid }
    func input(_ value:[String:Any]) {
        if value["quit"] as? Bool == true { NSRunningApplication(processIdentifier:pid)?.terminate();return }
        if value["requestPermissions"] as? Bool == true {
            if !CGPreflightScreenCaptureAccess() { _=CGRequestScreenCaptureAccess() }
            if !AXIsProcessTrusted() { _=AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String:true] as CFDictionary) }
            return
        }
        if AXIsProcessTrusted() { controller?.input(value) }
    }
}

private final class Output: NSObject, SCStreamOutput, @unchecked Sendable {
    let width: Int, height: Int, status: URL, windowID: CGWindowID, titlebar: CGFloat
    let lock=NSLock()
    var latest: Data?, audio=[Data]()
    var sourceFrames=0, outputFrames=0, audioSamples=0, audioPeak=0
    var measuredAt=ProcessInfo.processInfo.systemUptime
    var timer: DispatchSourceTimer?
    init(width: Int,height: Int,status: URL,windowID:CGWindowID,titlebar:CGFloat) { self.width=width;self.height=height;self.status=status;self.windowID=windowID;self.titlebar=titlebar }
    func packet(_ kind: String,_ data: Data) {
        var size=UInt32(data.count).bigEndian
        var header=Data(kind.utf8)
        withUnsafeBytes(of:&size) { header.append(contentsOf:$0) }
        FileHandle.standardOutput.write(header)
        FileHandle.standardOutput.write(data)
    }
    func start() {
        let timer=DispatchSource.makeTimerSource(queue:DispatchQueue(label:"suite.desktop.output",qos:.userInteractive))
        timer.schedule(deadline:.now(),repeating:.nanoseconds(16_666_667),leeway:.microseconds(100))
        timer.setEventHandler { [weak self] in self?.emit() }
        self.timer=timer;timer.resume()
    }
    func emit() {
        lock.lock();let frame=latest;let sound=audio;audio.removeAll(keepingCapacity:true);lock.unlock()
        if let frame { packet("VID1",frame);outputFrames += 1 }
        for chunk in sound { packet("AUD1",chunk) }
        let now=ProcessInfo.processInfo.systemUptime,elapsed=now-measuredAt
        if elapsed>=1 {
            lock.lock()
            sendStatus(permissionStatus())
            let value:[String:Any]=["screenLocked":(CGSessionCopyCurrentDictionary() as? [String:Any])?["CGSSessionScreenIsLocked"] as? Bool ?? false,"sourceFps":Double(sourceFrames)/elapsed,"outputFps":Double(outputFrames)/elapsed,
                                  "audioSamples":audioSamples,"audioPeak":audioPeak,"updatedAt":Date().timeIntervalSince1970]
            sourceFrames=0;audioSamples=0;audioPeak=0;lock.unlock()
            if let data=try? JSONSerialization.data(withJSONObject:value) { try? data.write(to:status,options:.atomic) }
            measuredAt=now;outputFrames=0
        }
    }
    func stream(_ stream: SCStream,didOutputSampleBuffer sample: CMSampleBuffer,of type: SCStreamOutputType) {
        guard sample.isValid else { return }
        if type == .audio { receiveAudio(sample);return }
        guard type == .screen,
              let attachments=CMSampleBufferGetSampleAttachmentsArray(sample,createIfNecessary:false) as? [[SCStreamFrameInfo:Any]],
              attachments.first?[.status] as? Int == SCFrameStatus.complete.rawValue,
              let pixels=sample.imageBuffer else { return }
        let sourceWidth=CVPixelBufferGetWidth(pixels),sourceHeight=CVPixelBufferGetHeight(pixels)
        guard sourceWidth>0,sourceHeight>Int(titlebar) else { return }
        let scale=min(CGFloat(sourceWidth)/CGFloat(width),(CGFloat(sourceHeight)-titlebar)/CGFloat(height))
        let left=(CGFloat(sourceWidth)-CGFloat(width)*scale)/2
        let top=titlebar+(CGFloat(sourceHeight)-titlebar-CGFloat(height)*scale)/2
        CVPixelBufferLockBaseAddress(pixels,.readOnly)
        defer { CVPixelBufferUnlockBaseAddress(pixels,.readOnly) }
        guard let base=CVPixelBufferGetBaseAddress(pixels) else { return }
        let stride=CVPixelBufferGetBytesPerRow(pixels)
        var rgba=Data(count:width*height*4)
        rgba.withUnsafeMutableBytes { bytes in
            let out=bytes.bindMemory(to:UInt8.self)
            for y in 0..<height {
                let sourceY=min(sourceHeight-1,max(0,Int(top+(CGFloat(y)+0.5)*scale)))
                let row=base.advanced(by:sourceY*stride).assumingMemoryBound(to:UInt8.self)
                for x in 0..<width {
                    let sourceX=min(sourceWidth-1,max(0,Int(left+(CGFloat(x)+0.5)*scale)))
                    let at=(y*width+x)*4,src=sourceX*4
                    out[at]=row[src+2];out[at+1]=row[src+1];out[at+2]=row[src];out[at+3]=255
                }
            }
        }
        lock.lock();latest=rgba;sourceFrames += 1;lock.unlock()
    }
    func receiveAudio(_ sample: CMSampleBuffer) {
        guard let format=sample.formatDescription,
              let description=CMAudioFormatDescriptionGetStreamBasicDescription(format) else { return }
        let asbd=description.pointee
        guard asbd.mFormatID==kAudioFormatLinearPCM,Int(asbd.mSampleRate)==48000 else { return }
        var size=0
        CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(sample,bufferListSizeNeededOut:&size,bufferListOut:nil,
            bufferListSize:0,blockBufferAllocator:nil,blockBufferMemoryAllocator:nil,flags:0,blockBufferOut:nil)
        guard size>0,size<4096 else { return }
        let storage=UnsafeMutableRawPointer.allocate(byteCount:size,alignment:MemoryLayout<AudioBufferList>.alignment)
        defer { storage.deallocate() }
        let list=storage.bindMemory(to:AudioBufferList.self,capacity:1)
        var block: CMBlockBuffer?
        guard CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(sample,bufferListSizeNeededOut:nil,bufferListOut:list,
            bufferListSize:size,blockBufferAllocator:nil,blockBufferMemoryAllocator:nil,flags:0,blockBufferOut:&block)==noErr else { return }
        let buffers=UnsafeMutableAudioBufferListPointer(list),frames=CMSampleBufferGetNumSamples(sample)
        guard frames>0,frames<=48000,!buffers.isEmpty else { return }
        let planar=(asbd.mFormatFlags & kAudioFormatFlagIsNonInterleaved) != 0
        let floating=(asbd.mFormatFlags & kAudioFormatFlagIsFloat) != 0
        guard (floating && asbd.mBitsPerChannel==32) || (!floating && asbd.mBitsPerChannel==16) else { return }
        var pcm=Data(count:frames*4),peak=0
        pcm.withUnsafeMutableBytes { raw in
            let target=raw.bindMemory(to:Int16.self)
            for frame in 0..<frames { for channel in 0..<2 {
                let sourceChannel=min(channel,Int(asbd.mChannelsPerFrame)-1)
                let buffer=buffers[planar ? min(sourceChannel,buffers.count-1) : 0]
                guard let pointer=buffer.mData else { continue }
                let index=planar ? frame : frame*Int(asbd.mChannelsPerFrame)+sourceChannel
                guard (index+1)*Int(asbd.mBitsPerChannel/8)<=Int(buffer.mDataByteSize) else { continue }
                let sample: Int16
                if floating {
                    let value=pointer.assumingMemoryBound(to:Float.self)[index]
                    sample=Int16(max(-32768,min(32767,(value.isFinite ? value : 0)*32767)))
                } else { sample=pointer.assumingMemoryBound(to:Int16.self)[index] }
                target[frame*2+channel]=sample;peak=max(peak,abs(Int(sample)))
            }}
        }
        lock.lock()
        if audio.count>=30 { audio.removeFirst() }
        audio.append(pcm);audioSamples += frames;audioPeak=max(audioPeak,peak)
        lock.unlock()
    }
}

@MainActor private final class Controller {
    let pid: pid_t,windowID: CGWindowID,titlebar: CGFloat
    var frame: CGRect,keys=Set<CGKeyCode>(),touchDown=false
    var postedKeys=[CGKeyCode:CGKeyCode]()
    init(pid: pid_t,window: SCWindow,titlebar: CGFloat) {
        self.pid=pid;self.windowID=window.windowID;self.frame=window.frame;self.titlebar=titlebar
    }
    func input(_ value:[String:Any]) {
        let next=Set((value["keys"] as? [Int] ?? []).filter { $0>=0 && $0<128 }.map { CGKeyCode($0) })
        for key in keys.subtracting(next) { keyboard(key,false) }
        for key in next.subtracting(keys) { keyboard(key,true) }
        keys=next
        if let touch=value["touch"] as? [String:Any],let x=touch["x"] as? Double,let y=touch["y"] as? Double {
            let down=touch["pressed"] as? Bool ?? false
            if down || touchDown {
                if let windows=CGWindowListCopyWindowInfo(.optionIncludingWindow,windowID) as? [[String:Any]],
                   let bounds=windows.first?[kCGWindowBounds as String] as? NSDictionary,
                   let current=CGRect(dictionaryRepresentation:bounds) { frame=current }
                // 400x480 stacked 3DS: the 320x240 lower LCD is centered at x=40.
                let contentHeight=frame.height-titlebar
                let scale=min(frame.width/400,contentHeight/480)
                let position=CGPoint(x:frame.minX+(frame.width-400*scale)/2+(40+x)*scale,
                                     y:frame.minY+titlebar+(contentHeight-480*scale)/2+(240+y)*scale)
                let type: CGEventType=down ? (touchDown ? .leftMouseDragged : .leftMouseDown) : .leftMouseUp
                if let event=CGEvent(mouseEventSource:nil,mouseType:type,mouseCursorPosition:position,mouseButton:.left) {
                    event.setIntegerValueField(.mouseEventWindowUnderMousePointer,value:Int64(windowID))
                    event.setIntegerValueField(.mouseEventWindowUnderMousePointerThatCanHandleThisEvent,value:Int64(windowID))
                    event.postToPid(pid)
                }
            }
            touchDown=down
        }
        if value["quit"] as? Bool == true { NSRunningApplication(processIdentifier:pid)?.terminate() }
    }
    func keyboard(_ key:CGKeyCode,_ down:Bool) {
        let physical:CGKeyCode
        if down {
            physical=SuiteKeyboard.resolve(key,layout:SuiteKeyboard.currentLayout())
            postedKeys[key]=physical
        } else {
            // Release the same physical key even if the input layout changes
            // while it is held. Unicode-only overrides can leave a Qt key stuck.
            physical=postedKeys.removeValue(forKey:key) ?? key
        }
        if let event=CGEvent(keyboardEventSource:nil,virtualKey:physical,keyDown:down) {
            event.flags=[];event.postToPid(pid)
        }
    }
    func release() { input(["keys":[],"touch":["x":0,"y":0,"pressed":false]]) }
}

@main private struct SuiteDesktop {
    @MainActor static func main() async {
        do {
            let args=CommandLine.arguments
            func arg(_ key:String) throws -> String {
                guard let at=args.firstIndex(of:key),at+1<args.count else { throw Failure.message("Missing \(key)") }
                return args[at+1]
            }
            let pid=pid_t(try arg("--pid"))!
            if args.contains("--quit") {
                guard NSRunningApplication(processIdentifier:pid)?.terminate() == true else { throw Failure.message("The game did not accept a normal quit request.") }
                return
            }
            if args.contains("--permissions") { print(permissionStatus());return }
            let width=Int(try arg("--width"))!,height=Int(try arg("--height"))!
            let windowWidth=Double(try arg("--window-width"))!,windowHeight=Double(try arg("--window-height"))!
            let titlebar=Double(try arg("--titlebar"))!
            let status=URL(fileURLWithPath:try arg("--status"))
            NSApplication.shared.setActivationPolicy(.prohibited)
            let remote=RemoteController(pid:pid)
            Task.detached {
                while let line=readLine(),line.utf8.count<=8192 {
                    if let data=line.data(using:.utf8),let value=try? JSONSerialization.jsonObject(with:data) as? [String:Any] { await remote.input(value) }
                }
                await remote.controller?.release();exit(0)
            }
            while !CGPreflightScreenCaptureAccess() {
                sendStatus(permissionStatus())
                guard NSRunningApplication(processIdentifier:pid)?.isTerminated==false else { return }
                try await Task.sleep(for:.seconds(1))
            }
            sendStatus(permissionStatus())
            let deadline=Date().addingTimeInterval(60)
            var selected:SCWindow?
            repeat {
                let content=try await SCShareableContent.excludingDesktopWindows(false,onScreenWindowsOnly:false)
                selected=content.windows.filter { $0.owningApplication?.processID==pid && $0.frame.width>=320 && $0.frame.height>=240 }
                    .max { $0.frame.width*$0.frame.height < $1.frame.width*$1.frame.height }
                if selected != nil { break }
                try await Task.sleep(for:.milliseconds(200))
            } while Date()<deadline
            guard let initial=selected else { throw Failure.message("The game window did not appear.") }
            let app=AXUIElementCreateApplication(pid)
            var windowsValue:CFTypeRef?
            if AXUIElementCopyAttributeValue(app,kAXWindowsAttribute as CFString,&windowsValue) == .success,
               let windows=windowsValue as? [AXUIElement] {
                for window in windows {
                    var size=CGSize(width:windowWidth,height:windowHeight)
                    if let value=AXValueCreate(.cgSize,&size) { AXUIElementSetAttributeValue(window,kAXSizeAttribute as CFString,value) }
                }
            }
            try await Task.sleep(for:.milliseconds(500))
            let content=try await SCShareableContent.excludingDesktopWindows(false,onScreenWindowsOnly:false)
            let window=content.windows.first { $0.windowID==initial.windowID } ?? initial
            log("Suite captures window \(window.windowID): \(window.frame.width)x\(window.frame.height)")
            let controller=Controller(pid:pid,window:window,titlebar:titlebar);remote.controller=controller
            let config=SCStreamConfiguration()
            config.width=Int(window.frame.width);config.height=Int(window.frame.height);config.ignoreGlobalClipSingleWindow=true;config.minimumFrameInterval=CMTime(value:1,timescale:60)
            config.queueDepth=4;config.pixelFormat=kCVPixelFormatType_32BGRA;config.showsCursor=false
            config.ignoreShadowsSingleWindow=true;config.scalesToFit=true
            // ScreenCaptureKit captures the full window. Crop its actual,
            // current bounds in Output so resizing cannot clip either LCD.
            config.capturesAudio=true;config.sampleRate=48000;config.channelCount=2
            let output=Output(width:width,height:height,status:status,windowID:window.windowID,titlebar:titlebar)
            let stream=SCStream(filter:SCContentFilter(desktopIndependentWindow:window),configuration:config,delegate:nil)
            let queue=DispatchQueue(label:"suite.desktop.capture",qos:.userInteractive)
            try stream.addStreamOutput(output,type:.screen,sampleHandlerQueue:queue)
            try stream.addStreamOutput(output,type:.audio,sampleHandlerQueue:queue)
            try await stream.startCapture();output.start()
            while NSRunningApplication(processIdentifier:pid)?.isTerminated==false {
                try await Task.sleep(for:.seconds(1))
                if let info=CGWindowListCopyWindowInfo(.optionIncludingWindow,window.windowID) as? [[String:Any]],
                   let bounds=info.first?[kCGWindowBounds as String] as? NSDictionary,
                   let current=CGRect(dictionaryRepresentation:bounds),current.width>=320,current.height>=240,
                   (config.width != Int(current.width) || config.height != Int(current.height)) {
                    config.width=Int(current.width);config.height=Int(current.height)
                    try await stream.updateConfiguration(config)
                }
            }
            controller.release();try await stream.stopCapture()
        } catch { sendStatus(["state":"error","message":"3DS video could not start: \(error)"]);log("Suite desktop: \(error)");exit(1) }
    }
}
