import Foundation

public enum CartridgeItem {
    /// Telemetry and ROM graphics use cartridge IDs; farming catalogs retain
    /// their global database IDs and provide nativeId for this translation.
    public static func name(nativeID: Int, catalog: [JSONValue]) -> String? {
        guard nativeID > 0 else { return nil }
        return catalog.first { !$0["nativeId"].isNull && $0["nativeId"].int == nativeID }?["name"].string.nonempty
    }
}
