import AppKit
import Combine
import SuiteCore

func readServiceOutput(from handle: FileHandle) -> Data? {
    let data = handle.availableData
    // EOF remains readable. Detach on the reader queue, before scheduling any
    // main-actor work, or an exited service queues unbounded empty callbacks.
    guard !data.isEmpty else { handle.readabilityHandler = nil; return nil }
    return data
}

@MainActor final class ServiceHost: ObservableObject {
    @Published var message = "Opening Pokémon Suite…"
    @Published var baseURL: URL?
    private var process: Process?
    private var input: Pipe?
    private var output: Pipe?
    private var errors: Pipe?
    private var pending = Data()
    private var stderr = ""
    private var launchID = UUID()
    private var quitting = false

    var running: Bool { process?.isRunning == true }

    func start(profile: URL) async throws -> URL {
        if let baseURL, running { return baseURL }
        guard let resources = Bundle.main.resourceURL else { throw SuiteError("The app resources are missing.") }
        let runtime = resources.appendingPathComponent("Runtime")
        let python = runtime.appendingPathComponent("python/bin/python3")
        let node = runtime.appendingPathComponent("node/bin/node")
        let suite = resources.appendingPathComponent("Suite")
        for file in [python, node, suite.appendingPathComponent("pokemon_suite/__main__.py")] {
            guard FileManager.default.fileExists(atPath: file.path) else { throw SuiteError("The app installation is incomplete. Reinstall Pokémon Suite.") }
        }
        let id = UUID(); baseURL = nil; launchID = id; pending = Data(); stderr = ""; quitting = false
        let child = Process(), stdin = Pipe(), stdout = Pipe(), stderrPipe = Pipe()
        child.executableURL = python
        child.arguments = ["-m", "pokemon_suite", "--data-dir", profile.path, "serve", "--port", "0", "--desktop-node", node.path]
        child.currentDirectoryURL = suite
        var environment = ProcessInfo.processInfo.environment
        for key in ["PYTHONPATH", "PYTHONHOME", "NODE_OPTIONS", "VIRTUAL_ENV"] { environment.removeValue(forKey: key) }
        environment["PATH"] = node.deletingLastPathComponent().path + ":/usr/bin:/bin:/usr/sbin:/sbin"
        environment["POKEMON_SUITE_DESKTOP_NODE"] = node.path
        let radioRuntime = runtime.appendingPathComponent("RadioHost")
        if FileManager.default.fileExists(atPath: radioRuntime.appendingPathComponent("radio-manifest.json").path) {
            environment["POKEMON_SUITE_RADIO_RUNTIME"] = radioRuntime.path
        } else {
            environment.removeValue(forKey: "POKEMON_SUITE_RADIO_RUNTIME")
        }
        let gameResources = resources.appendingPathComponent("GameResources")
        if FileManager.default.fileExists(atPath: gameResources.appendingPathComponent("firered").path) {
            environment["POKEMON_SUITE_GAME_RESOURCES"] = gameResources.path
        } else {
            environment.removeValue(forKey: "POKEMON_SUITE_GAME_RESOURCES")
        }
        environment["POKEMON_SUITE_DESKTOP_PARENT_PID"] = String(ProcessInfo.processInfo.processIdentifier)
        environment["PYTHONNOUSERSITE"] = "1"
        environment["PYTHONDONTWRITEBYTECODE"] = "1"
        environment["PYTHONUNBUFFERED"] = "1"
        child.environment = environment
        child.standardInput = stdin; child.standardOutput = stdout; child.standardError = stderrPipe
        stdout.fileHandleForReading.readabilityHandler = { [weak self] handle in
            guard let data = readServiceOutput(from: handle) else { return }
            Task { @MainActor in self?.received(data, id: id) }
        }
        stderrPipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            guard let data = readServiceOutput(from: handle) else { return }
            Task { @MainActor in
                guard let self, self.launchID == id else { return }
                self.stderr = String((self.stderr + String(decoding: data, as: UTF8.self)).suffix(4000))
            }
        }
        child.terminationHandler = { [weak self] _ in
            Task { @MainActor in
                guard let self, self.launchID == id else { return }
                self.baseURL = nil
                if !self.quitting { self.message = self.stderr.nonempty ?? "The Suite service stopped. Your saved progress is preserved." }
            }
        }
        process = child; input = stdin; output = stdout; errors = stderrPipe
        try child.run()
        for _ in 0..<300 {
            if let baseURL { return baseURL }
            if !child.isRunning { throw SuiteError(stderr.nonempty ?? "The local Suite service could not start.") }
            try await Task.sleep(for: .milliseconds(100))
        }
        // No game was launched through this unopened service. Close its parent
        // pipe so its ordinary lifecycle handler can release it.
        try? input?.fileHandleForWriting.close()
        throw SuiteError("The local Suite service took too long to start.")
    }

    private func received(_ data: Data, id: UUID) {
        guard id == launchID, baseURL == nil, !data.isEmpty else { return }
        pending.append(data)
        if pending.count > 64 * 1024 { message = "The local service returned an invalid startup response."; return }
        while let end = pending.firstIndex(of: 10) {
            let line = pending.prefix(upTo: end)
            pending.removeSubrange(...end)
            if let announcement = try? ServiceAnnouncement(data: Data(line)) {
                baseURL = announcement.url; message = "Connected"; return
            }
        }
    }

    func cancelStartup() { quitting = true; try? input?.fileHandleForWriting.close() }

    func finishAfterGracefulQuit() async throws {
        quitting = true
        for _ in 0..<50 {
            if !running {
                output?.fileHandleForReading.readabilityHandler = nil
                errors?.fileHandleForReading.readabilityHandler = nil
                try? input?.fileHandleForWriting.close()
                process = nil; baseURL = nil; return
            }
            try await Task.sleep(for: .milliseconds(100))
        }
        quitting = false
        throw SuiteError("The Suite is still closing. Wait for its save operation to finish and try again.")
    }
}
