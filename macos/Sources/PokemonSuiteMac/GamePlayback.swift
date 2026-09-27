#if canImport(AppKit)
import AppKit
#else
import UIKit
#endif
import AVFoundation
import Combine
import SuiteCore

final class FrameConnection: NSObject, URLSessionDataDelegate {
    private var session: URLSession?
    private var continuation: AsyncThrowingStream<GameFrame, Error>.Continuation?
    private var decoder = FrameDecoder()
    private var certificateSHA256: String?
    func frames(request: URLRequest, certificateSHA256: String? = nil) -> AsyncThrowingStream<GameFrame, Error> {
        self.certificateSHA256 = certificateSHA256
        return AsyncThrowingStream(bufferingPolicy: .bufferingNewest(1)) { continuation in
            self.continuation = continuation
            let queue = OperationQueue(); queue.maxConcurrentOperationCount = 1
            let configuration = URLSessionConfiguration.ephemeral
            configuration.timeoutIntervalForRequest = 15
            self.session = URLSession(configuration: configuration, delegate: self, delegateQueue: queue)
            var request = request
            request.timeoutInterval = 15
            self.session?.dataTask(with: request).resume()
            continuation.onTermination = { [weak self] _ in self?.stop() }
        }
    }
    func urlSession(_ session: URLSession, didReceive challenge: URLAuthenticationChallenge, completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) { SuiteTrust.handle(challenge, fingerprint: certificateSHA256, completion: completionHandler) }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        if (response as? HTTPURLResponse)?.statusCode == 200 { completionHandler(.allow) }
        else { continuation?.finish(throwing: SuiteError("Reconnecting to the game…")); completionHandler(.cancel) }
    }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        do { if let frame = try decoder.append(data) { continuation?.yield(frame) } }
        catch { continuation?.finish(throwing: error); stop() }
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        continuation?.finish(throwing: error ?? SuiteError("Reconnecting to the game…"))
    }
    func stop() { session?.invalidateAndCancel(); session = nil }
}

final class GameAudio: NSObject, URLSessionDataDelegate {
    private let engine = AVAudioEngine()
    private let player = AVAudioPlayerNode()
    private var session: URLSession?
    private var format: AVAudioFormat?
    private var pending = Data()
    private let lock = NSLock()
    private var queuedFrames = 0
    private var active = false
    private var generation = 0
    var onError: ((String) -> Void)?
    private var certificateSHA256: String?

    func start(request: URLRequest, sampleRate: Double, certificateSHA256: String? = nil) throws {
        self.certificateSHA256 = certificateSHA256
        stop()
        guard (8000...192000).contains(sampleRate), let format = AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: 2) else { throw SuiteError("This emulator has no compatible audio feed.") }
        self.format = format
        if player.engine == nil { engine.attach(player) }
        engine.connect(player, to: engine.mainMixerNode, format: format)
        try engine.start(); player.play()
        lock.lock(); active = true; generation += 1; lock.unlock()
        let queue = OperationQueue(); queue.maxConcurrentOperationCount = 1
        session = URLSession(configuration: .ephemeral, delegate: self, delegateQueue: queue)
        session?.dataTask(with: request).resume()
    }
    func urlSession(_ session: URLSession, didReceive challenge: URLAuthenticationChallenge, completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) { SuiteTrust.handle(challenge, fingerprint: certificateSHA256, completion: completionHandler) }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        let valid = (response as? HTTPURLResponse)?.statusCode == 200
        if !valid { onError?("The emulator’s audio feed is unavailable.") }
        completionHandler(valid ? .allow : .cancel)
    }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        lock.lock(); defer { lock.unlock() }
        guard active, let format else { return }
        pending.append(data)
        let count = pending.count / 4
        guard count > 0 else { return }
        let bytes = Data(pending.prefix(count * 4)); pending = Data(pending.dropFirst(count * 4))
        guard queuedFrames < Int(format.sampleRate / 4), let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(count)), let channels = buffer.floatChannelData else { return }
        buffer.frameLength = AVAudioFrameCount(count)
        bytes.withUnsafeBytes { raw in
            for frame in 0..<count {
                channels[0][frame] = Float(Int16(littleEndian: raw.loadUnaligned(fromByteOffset: frame * 4, as: Int16.self))) / 32768
                channels[1][frame] = Float(Int16(littleEndian: raw.loadUnaligned(fromByteOffset: frame * 4 + 2, as: Int16.self))) / 32768
            }
        }
        queuedFrames += count
        let current = generation
        player.scheduleBuffer(buffer, completionCallbackType: .dataPlayedBack) { [weak self] _ in
            guard let self else { return }; self.lock.lock(); defer { self.lock.unlock() }
            if current == self.generation { self.queuedFrames = max(0, self.queuedFrames - count) }
        }
    }
    func stop() {
        lock.lock(); active = false; generation += 1; pending.removeAll(); queuedFrames = 0; lock.unlock()
        session?.invalidateAndCancel(); session = nil; player.stop(); engine.stop()
    }
}

@MainActor final class GamePlayback: ObservableObject {
    @Published var image: CGImage?
    @Published var message = "Start a game to connect its screen."
    @Published var sound = false
    @Published var frameCount = 0
    var manual = false {
        didSet { if !manual { releaseInput() } }
    }
    private var key = ""
    private var game = ""
    private var platform = "gba"
    private var api: SuiteAPI?
    private var task: Task<Void, Never>?
    private var inputTask: Task<Void, Never>?
    private var inputHeartbeat: Task<Void, Never>?
    private var inputSources = GameInputSources()
    private var desiredInput = GameInputState()
    private var inputGeneration = 0
    private var connection: FrameConnection?
    private let audio = GameAudio()
    private var audioTask: Task<Void, Never>?

    func connect(api: SuiteAPI, game: String, sessionID: String, platform: String = "gba") {
        let next = api.cacheIdentity.uuidString + ":" + game + ":" + sessionID
        guard next != key else { return }
        stop(); self.api = api; self.game = game; self.platform = platform; key = next
        message = "Connecting to the game…"
        task = Task { [weak self] in
            while !Task.isCancelled {
                guard let self, self.key == next else { return }
                do {
                    let request = try await api.request("/game/\(game)/stream")
                    guard !Task.isCancelled, self.key == next else { return }
                    let connection = FrameConnection(); self.connection = connection
                    for try await frame in connection.frames(request: request, certificateSHA256: api.certificateSHA256) {
                        guard !Task.isCancelled, self.key == next else { return }
                        let provider = CGDataProvider(data: frame.pixels as CFData)
                        self.image = provider.flatMap { CGImage(width: frame.width, height: frame.height, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: frame.width * 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.last.rawValue), provider: $0, decode: nil, shouldInterpolate: false, intent: .defaultIntent) }
                        self.frameCount += 1; self.message = ""
                    }
                } catch { if !Task.isCancelled && self.key == next { self.message = error.localizedDescription } }
                try? await Task.sleep(for: .seconds(1))
            }
        }
    }

    func toggleSound() {
        sound.toggle(); audioTask?.cancel()
        if !sound { audio.stop(); return }
        guard let api, !game.isEmpty else { sound = false; return }
        let game = game
        audioTask = Task {
            do {
                let health = try await api.get("/game/\(game)/health")
                guard health["audio"]["channels"].int == 2 else { throw SuiteError("This emulator has no compatible audio feed.") }
                let request = try await api.request("/game/\(game)/audio")
                guard !Task.isCancelled, sound else { return }
                try audio.start(request: request, sampleRate: health["audio"]["sampleRate"].double, certificateSHA256: api.certificateSHA256)
            } catch { if !Task.isCancelled { message = error.localizedDescription; sound = false } }
        }
    }

    func input(_ buttons: [String], source: String = "keyboard") { updateInput(GameInputState(buttons: buttons), source: source) }
    func updateInput(_ value: GameInputState, source: String) {
        guard manual || !value.isActive else { return }
        inputSources.update(source, value: value)
        sendInput(inputSources.merged)
    }
    private func sendInput(_ value: GameInputState) {
        guard let api, desiredInput != value else { return }
        desiredInput = value
        inputHeartbeat?.cancel(); inputHeartbeat = nil
        enqueueInput(value, api: api)
        if value.isActive {
            inputHeartbeat = Task { [weak self] in
                while !Task.isCancelled {
                    do { try await Task.sleep(for: .milliseconds(200)) } catch { return }
                    guard let self, self.manual, self.desiredInput.isActive, let api = self.api else { return }
                    // Do not build up a queue behind a slow connection. The
                    // emulator releases input itself if a refresh cannot arrive.
                    if self.inputTask == nil { self.enqueueInput(self.desiredInput, api: api) }
                }
            }
        }
    }
    private func enqueueInput(_ value: GameInputState, api: SuiteAPI) {
        inputGeneration += 1
        let payload = value.payload(game: game, platform: platform), version = inputGeneration, previous = inputTask
        inputTask = Task { [weak self] in
            // Preserve press/release ordering even when switching games while
            // an HTTP input is in flight. Each command owns its original game.
            await previous?.value
            // An old press must not reappear after a release or a game switch.
            // Releases always retain their original target and FIFO ordering.
            guard !value.isActive || (self?.manual == true && self?.inputGeneration == version) else { return }
            do { try await api.post("/api/pokemon-suite/input", payload) }
            catch { self?.message = error.localizedDescription }
            if self?.inputGeneration == version { self?.inputTask = nil }
        }
    }
    func releaseInput(source: String? = nil) {
        if let source { inputSources.update(source, value: GameInputState()) } else { inputSources.releaseAll() }
        sendInput(inputSources.merged)
    }
    func stop() {
        releaseInput(); task?.cancel(); task = nil; connection?.stop(); connection = nil
        inputHeartbeat?.cancel(); inputHeartbeat = nil
        audioTask?.cancel(); audio.stop(); sound = false
        key = ""; api = nil; game = ""; image = nil; message = "Start a game to connect its screen."; manual = false
    }
}
