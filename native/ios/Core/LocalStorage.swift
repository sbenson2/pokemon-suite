import Foundation
import CryptoKit

public final class LocalStorage {
    public let root: URL
    public var romURL: URL { root.appendingPathComponent("FireRed.gba") }
    public var checkpointURL: URL { root.appendingPathComponent("current.json") }
    public var previousCheckpointURL: URL { root.appendingPathComponent("previous.json") }
    public init(root: URL) throws {
        self.root = root
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    }
    public func importROM(_ data: Data) throws {
        guard data.count == 16_777_216,
              Insecure.SHA1.hash(data: data).map({ String(format: "%02x", $0) }).joined() == "dd5945db9b930750cb39d00c84da8571feebf417" else {
            throw StorageError.invalidROM
        }
        try data.write(to: romURL, options: .atomic)
    }
    public func saveCheckpoint(_ text: String) throws {
        let data = Data(text.utf8)
        guard data.count <= 32_000_000,
              let value = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              value["schema"] as? String == "pokemon-suite/mobile-checkpoint/v1" else { throw StorageError.invalidCheckpoint }
        if FileManager.default.fileExists(atPath: checkpointURL.path) {
            try Data(contentsOf: checkpointURL).write(to: previousCheckpointURL, options: .atomic)
        }
        // Preserve JavaScript's exact JSON bytes: its receipt hashes key order.
        try data.write(to: checkpointURL, options: .atomic)
    }
    @discardableResult public func archiveAdventure() throws -> URL? {
        guard FileManager.default.fileExists(atPath: checkpointURL.path) else { return nil }
        let directory = root.appendingPathComponent("Adventures", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let destination = directory.appendingPathComponent(UUID().uuidString + ".json")
        try FileManager.default.moveItem(at: checkpointURL, to: destination)
        return destination
    }
    public enum StorageError: LocalizedError {
        case invalidROM, invalidCheckpoint
        public var errorDescription: String? {
            switch self {
            case .invalidROM: return "Choose a FireRed US revision 1 ROM. This file does not match the supported cartridge."
            case .invalidCheckpoint: return "The local checkpoint is invalid. Your previous save was preserved."
            }
        }
    }
}
