import XCTest
@testable import SuiteCore

private actor WorkLog {
    var keys: [String] = []
    func record(_ key: String) { keys.append(key) }
    func count() -> Int { keys.count }
}

final class ArtworkLoadingTests: XCTestCase {
    func testConcurrentCardsShareOneLoadAndReturningCardUsesCache() async throws {
        let cache = AsyncResourceCache<String, Data>(costLimit: 1024, countLimit: 8, concurrency: 2, cost: { $0.count })
        let work = WorkLog()
        let results = try await withThrowingTaskGroup(of: Data.self) { group in
            for _ in 0..<12 { group.addTask {
                try await cache.value(for: "emerald-logo") {
                    await work.record("logo")
                    try await Task.sleep(for: .milliseconds(40))
                    return Data([1, 2, 3])
                }
            } }
            var values: [Data] = []; for try await value in group { values.append(value) }; return values
        }
        XCTAssertEqual(results, Array(repeating: Data([1, 2, 3]), count: 12))
        let again = try await cache.value(for: "emerald-logo") { XCTFail("Revisited card downloaded again"); return Data() }
        XCTAssertEqual(again, Data([1, 2, 3]))
        let count = await work.count(); XCTAssertEqual(count, 1)
    }

    func testFastScrollingDiscardsQueuedWorkButDoesNotCancelAnotherVisibleCard() async throws {
        let cache = AsyncResourceCache<String, Data>(costLimit: 1024, countLimit: 8, concurrency: 1, cost: { $0.count })
        let work = WorkLog()
        let started = expectation(description: "visible work started")
        let first = Task { try await cache.value(for: "visible") {
            started.fulfill(); try await Task.sleep(for: .milliseconds(200)); return Data([7])
        } }
        await fulfillment(of: [started], timeout: 2)
        let duplicate = Task { try await cache.value(for: "visible") { XCTFail("Duplicate render"); return Data() } }
        let offscreen = Task { try await cache.value(for: "offscreen") { await work.record("offscreen"); return Data([8]) } }
        try await Task.sleep(for: .milliseconds(20))
        offscreen.cancel(); duplicate.cancel()
        let fresh = Task { try await cache.value(for: "new-visible") { await work.record("new-visible"); return Data([9]) } }
        do { _ = try await offscreen.value; XCTFail("Offscreen waiter must cancel") } catch is CancellationError {} 
        do { _ = try await duplicate.value; XCTFail("Duplicate waiter must cancel") } catch is CancellationError {}
        let a = try await first.value, b = try await fresh.value
        XCTAssertEqual(a, Data([7])); XCTAssertEqual(b, Data([9]))
        let keys = await work.keys; XCTAssertEqual(keys, ["new-visible"])
    }

    func testFailureCanRetryAndCacheEvictsLeastRecentlyUsedByBytes() async throws {
        let cache = AsyncResourceCache<String, Data>(costLimit: 4, countLimit: 8, concurrency: 1, cost: { $0.count })
        do { _ = try await cache.value(for: "a") { throw SuiteError("Disconnected") }; XCTFail("Expected failure") } catch {}
        _ = try await cache.value(for: "a") { Data([1, 1]) }
        _ = try await cache.value(for: "b") { Data([2, 2]) }
        _ = try await cache.value(for: "a") { XCTFail("Not cached"); return Data() }
        _ = try await cache.value(for: "c") { Data([3, 3]) }
        let b = try await cache.value(for: "b") { Data([4, 4]) }
        XCTAssertEqual(b, Data([4, 4]))
    }

    func testArtworkIdentityUsesActualFallbackRevisionAndIsIndependentOfTelemetry() throws {
        let game: JSONValue = .object(["id": .string("red"), "platform": .string("gb"), "title": .string("Pokémon Red")])
        var art: JSONValue = .object([
            "firered": .object(["fingerprint": .string("sprite-v1"), "assets": .array([.string("pokemon")])]),
            "emerald": .object(["fingerprint": .string("logo-v1"), "assets": .array([.string("logo")])])
        ])
        let initial = CartridgeArtwork(game: game, artwork: art)
        XCTAssertEqual(initial.mascot?.path, "/api/rom-art/firered/pokemon/6.png")
        XCTAssertEqual(initial.logo?.path, "/api/rom-art/emerald/logo/pokemon.png")
        art["emerald"]["fingerprint"] = .string("logo-v2")
        XCTAssertNotEqual(initial, CartridgeArtwork(game: game, artwork: art))
        let blue: JSONValue = .object(["id": .string("blue")])
        XCTAssertEqual(initial.logo, CartridgeArtwork(game: blue, artwork: .object(["emerald": .object(["fingerprint": .string("logo-v1"), "assets": .array([.string("logo")])])])).logo)
        art["firered"]["assets"] = .array([])
        XCTAssertNil(CartridgeArtwork(game: game, artwork: art).mascot)
    }
}
