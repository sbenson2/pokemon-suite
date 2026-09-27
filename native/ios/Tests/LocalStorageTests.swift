import XCTest
@testable import SuiteMobileCore

final class LocalStorageTests: XCTestCase {
    func testCheckpointPreservesExactBytesAndKeepsPreviousReceipt() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let storage = try LocalStorage(root: root)
        let first = "{\"schema\":\"pokemon-suite/mobile-checkpoint/v1\",\"frame\":1,\"z\":2,\"a\":3}"
        let second = "{\"schema\":\"pokemon-suite/mobile-checkpoint/v1\",\"frame\":2}"
        try storage.saveCheckpoint(first)
        XCTAssertEqual(try String(contentsOf: storage.checkpointURL, encoding: .utf8), first)
        XCTAssertThrowsError(try storage.saveCheckpoint("not JSON"))
        XCTAssertEqual(try String(contentsOf: storage.checkpointURL, encoding: .utf8), first)
        try storage.saveCheckpoint(second)
        XCTAssertEqual(try String(contentsOf: storage.previousCheckpointURL, encoding: .utf8), first)
        XCTAssertEqual(try String(contentsOf: storage.checkpointURL, encoding: .utf8), second)
    }
    func testNewAdventureArchivesExistingSaveRatherThanOverwritingIt() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let storage = try LocalStorage(root: root)
        let saved = "{\"schema\":\"pokemon-suite/mobile-checkpoint/v1\",\"frame\":123}"
        try storage.saveCheckpoint(saved)
        let archived = try XCTUnwrap(storage.archiveAdventure())
        XCTAssertFalse(FileManager.default.fileExists(atPath: storage.checkpointURL.path))
        XCTAssertEqual(try String(contentsOf: archived, encoding: .utf8), saved)
    }
    func testInvalidROMCannotReplaceAnExistingCartridge() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let storage = try LocalStorage(root: root)
        try Data([1,2,3]).write(to: storage.romURL)
        XCTAssertThrowsError(try storage.importROM(Data(repeating: 0, count: 1024)))
        XCTAssertEqual(try Data(contentsOf: storage.romURL), Data([1,2,3]))
    }
}
