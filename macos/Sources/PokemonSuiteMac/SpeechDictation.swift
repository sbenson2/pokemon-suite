import AVFoundation
import Speech
import SuiteCore

/// Tap-to-start / tap-to-stop dictation for "Ask the bot" (Mac and companion).
/// Recognition runs only on this device (`requiresOnDeviceRecognition`); when
/// the language has no on-device recognizer the button explains that rather
/// than sending audio to a server. Speech and microphone permissions are
/// requested on the first tap, never at launch. The recognizer punctuates (so a
/// spoken list keeps its steps) and is told the game's names (`hints`).
@MainActor final class SpeechDictation: ObservableObject {
    @Published private(set) var listening = false
    @Published private(set) var preparing = false
    @Published var message: String?
    private var engine: AVAudioEngine?
    private var tapped = false
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var transcript = ""
    private var onPartial: ((String) -> Void)?
    private var onFinal: ((String) -> Void)?
    private var session = 0
    #if os(iOS)
    private var previousAudio: (category: AVAudioSession.Category, mode: AVAudioSession.Mode, options: AVAudioSession.CategoryOptions)?
    #endif

    /// Starts listening, or stops and delivers the final transcript.
    /// `hints`: names the recognizer should expect (DictationVocabulary, at most 100 are used).
    func toggle(hints: [String] = [], partial: @escaping (String) -> Void, final: @escaping (String) -> Void) {
        if listening { finish() }
        else if !preparing { Task { await start(hints: hints, partial: partial, final: final) } }
    }

    /// Abandons dictation without delivering anything (the view went away).
    func cancel() {
        session += 1
        task?.cancel(); task = nil
        onPartial = nil; onFinal = nil
        stopAudio(); request = nil
    }

    private func start(hints: [String], partial: @escaping (String) -> Void, final: @escaping (String) -> Void) async {
        preparing = true; message = nil
        defer { preparing = false }
        // Without the usage descriptions the system terminates an app that asks
        // for either permission, so nothing below runs in an unpackaged build.
        guard Self.usageDescriptions else {
            if case .blocked(let text) = DictationReadiness.evaluate(usageDescriptions: false, speech: .notDetermined, microphone: .notDetermined, recognizer: .onDevice, language: "") { message = text }
            return
        }
        let locale = Locale.current
        let language = locale.localizedString(forIdentifier: locale.identifier) ?? locale.identifier
        let recognizer = SFSpeechRecognizer(locale: locale)
        var readiness = Self.readiness(recognizer, language: language)
        if readiness == .needsPermission {
            if SFSpeechRecognizer.authorizationStatus() == .notDetermined { await Self.requestSpeech() }
            if Self.microphone() == .notDetermined { await Self.requestMicrophone() }
            readiness = Self.readiness(recognizer, language: language)
        }
        guard readiness == .ready, let recognizer else {
            if case .blocked(let text) = readiness { message = text }
            return
        }
        onPartial = partial; onFinal = final
        do { try begin(recognizer, hints: hints) } catch {
            cancel()
            message = error.localizedDescription
        }
    }

    private func begin(_ recognizer: SFSpeechRecognizer, hints: [String]) throws {
        #if os(iOS)
        let audio = AVAudioSession.sharedInstance()
        previousAudio = (audio.category, audio.mode, audio.categoryOptions)
        try audio.setCategory(.playAndRecord, mode: .measurement, options: [.defaultToSpeaker, .duckOthers])
        try audio.setActive(true)
        #endif
        let engine = AVAudioEngine()
        self.engine = engine
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        // A Mac mini has no built-in microphone; tapping a silent input would crash.
        guard format.sampleRate > 0, format.channelCount > 0 else { throw SuiteError(DictationReadiness.noMicrophone) }
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        request.requiresOnDeviceRecognition = true // audio never leaves this device
        request.addsPunctuation = true // "Heal my team. Go to Cinnabar and save.": each spoken step keeps its boundary
        request.contextualStrings = Array(hints.prefix(DictationVocabulary.limit)) // party, hunt target, commands, places
        self.request = request
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in request.append(buffer) }
        tapped = true
        engine.prepare()
        try engine.start()
        session += 1
        let id = session
        transcript = ""
        task = recognizer.recognitionTask(with: request) { [weak self] result, error in
            let text = result?.bestTranscription.formattedString
            let done = result?.isFinal == true || error != nil
            Task { @MainActor in self?.update(id, text: text, done: done) }
        }
        listening = true
    }

    private func update(_ id: Int, text: String?, done: Bool) {
        guard id == session else { return }
        if let text, !text.isEmpty { transcript = text; onPartial?(text) }
        if done { complete() }
    }

    /// Stops recording; the recognizer then delivers its final transcript
    /// (or the latest partial one if it does not answer promptly).
    private func finish() {
        guard listening else { return }
        stopAudio()
        let id = session
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(2))
            if let self, self.session == id { self.complete() }
        }
    }

    private func complete() {
        let text = transcript.trimmingCharacters(in: .whitespacesAndNewlines), deliver = onFinal
        session += 1
        task?.cancel(); task = nil
        onPartial = nil; onFinal = nil
        stopAudio(); request = nil
        if text.isEmpty { message = DictationReadiness.nothingHeard } else { deliver?(text) }
    }

    private func stopAudio() {
        if let engine {
            engine.stop()
            if tapped { engine.inputNode.removeTap(onBus: 0) }
        }
        engine = nil; tapped = false
        request?.endAudio()
        listening = false
        #if os(iOS)
        if let previousAudio { try? AVAudioSession.sharedInstance().setCategory(previousAudio.category, mode: previousAudio.mode, options: previousAudio.options) }
        previousAudio = nil
        #endif
    }

    static var usageDescriptions: Bool {
        ["NSMicrophoneUsageDescription", "NSSpeechRecognitionUsageDescription"].allSatisfy {
            (Bundle.main.object(forInfoDictionaryKey: $0) as? String)?.isEmpty == false
        }
    }

    private static func readiness(_ recognizer: SFSpeechRecognizer?, language: String) -> DictationReadiness {
        let support: DictationRecognizer
        if let recognizer {
            support = !recognizer.supportsOnDeviceRecognition ? .serverOnly : recognizer.isAvailable ? .onDevice : .unavailable
        } else { support = .unsupportedLocale }
        return DictationReadiness.evaluate(usageDescriptions: usageDescriptions, speech: speech(), microphone: microphone(), recognizer: support, language: language)
    }

    private static func speech() -> DictationPermission {
        switch SFSpeechRecognizer.authorizationStatus() {
        case .authorized: return .authorized
        case .denied: return .denied
        case .restricted: return .restricted
        default: return .notDetermined
        }
    }

    private static func microphone() -> DictationPermission {
        #if os(iOS)
        switch AVAudioApplication.shared.recordPermission {
        case .granted: return .authorized
        case .denied: return .denied
        default: return .notDetermined
        }
        #else
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized: return .authorized
        case .denied: return .denied
        case .restricted: return .restricted
        default: return .notDetermined
        }
        #endif
    }

    private static func requestSpeech() async {
        await withCheckedContinuation { (done: CheckedContinuation<Void, Never>) in SFSpeechRecognizer.requestAuthorization { _ in done.resume() } }
    }

    private static func requestMicrophone() async {
        #if os(iOS)
        _ = await AVAudioApplication.requestRecordPermission()
        #else
        _ = await AVCaptureDevice.requestAccess(for: .audio)
        #endif
    }
}
