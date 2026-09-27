import XCTest
import Network
@testable import PokemonSuiteMac
import SuiteCore

private final class ScreenServer {
    let listener: NWListener
    private let lock = NSLock()
    private var unavailable = false
    let ready = XCTestExpectation(description: "Screen server listening")
    var url: URL { URL(string: "http://127.0.0.1:\(listener.port!.rawValue)")! }
    func fail(_ value: Bool) { lock.lock(); unavailable = value; lock.unlock() }

    init() throws {
        listener = try NWListener(using: .tcp, on: .any)
        listener.stateUpdateHandler = { [weak self] state in if case .ready = state { self?.ready.fulfill() } }
        listener.newConnectionHandler = { [weak self] connection in
            connection.start(queue: .global())
            connection.receive(minimumIncompleteLength: 1, maximumLength: 8192) { _, _, _, _ in
                guard let self else { connection.cancel(); return }
                self.lock.lock(); let unavailable = self.unavailable; self.lock.unlock()
                let pixels = Data([0x4d,0x52,0x46,0x31,0,1,0,1,0,0,0,4,0,0,0,1,10,20,30,255])
                let data = unavailable ? Data() : pixels
                let headers = "HTTP/1.1 \(unavailable ? "503 Unavailable" : "200 OK")\r\nContent-Length: \(data.count)\r\nConnection: close\r\n\r\n"
                connection.send(content: Data(headers.utf8) + data, completion: .contentProcessed { _ in connection.cancel() })
            }
        }
        listener.start(queue: .global())
    }
    func stop() { listener.cancel() }
}

final class PlaybackRecoveryTests: XCTestCase {
    @MainActor func until(_ condition: @escaping @MainActor () -> Bool) async throws {
        for _ in 0..<100 {
            if condition() { return }
            try await Task.sleep(for: .milliseconds(50))
        }
        XCTFail("Playback did not reach the expected state")
    }

    @MainActor func testMissingStreamRetainsFrameAndReconnectsWithoutAskingToStartGame() async throws {
        let server = try ScreenServer(); defer { server.stop() }
        await fulfillment(of: [server.ready], timeout: 5)
        let api = SuiteAPI(baseURL: server.url)
        let playback = GamePlayback(); defer { playback.stop() }
        playback.connect(api: api, game: "firered", sessionID: "running")
        try await until { playback.frameCount > 0 }
        server.fail(true)
        try await Task.sleep(for: .milliseconds(1500))
        XCTAssertNotNil(playback.image)
        XCTAssertTrue(playback.message.contains("Reconnecting"), playback.message)
        let before = playback.frameCount
        server.fail(false)
        try await until { playback.frameCount > before }
        playback.stop()
        XCTAssertNil(playback.image)
    }

    @MainActor func testReconnectingToNewHostWithSameSessionDoesNotKeepOldTransport() async throws {
        let first = try ScreenServer(), second = try ScreenServer()
        defer { first.stop(); second.stop() }
        await fulfillment(of: [first.ready, second.ready], timeout: 5)
        let playback = GamePlayback(); defer { playback.stop() }
        playback.connect(api: SuiteAPI(baseURL: first.url), game: "firered", sessionID: "same")
        try await until { playback.frameCount > 0 }
        first.fail(true)
        let before = playback.frameCount
        playback.connect(api: SuiteAPI(baseURL: second.url), game: "firered", sessionID: "same")
        try await until { playback.frameCount > before }
    }
}
