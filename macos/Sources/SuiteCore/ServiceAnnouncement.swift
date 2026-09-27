import Foundation

public struct ServiceAnnouncement: Sendable {
    public let url: URL
    public init(data: Data) throws {
        let value = try JSONDecoder().decode(JSONValue.self, from: data)
        guard value["product"].string == "pokemon-suite",
              let address = URL(string: value["url"].string), address.scheme == "http",
              address.host == "127.0.0.1", address.user == nil, address.password == nil,
              address.path == "/", address.query == nil, address.fragment == nil,
              let port = address.port, port > 0, port == value["port"].int else {
            throw SuiteError("The local Suite service returned an invalid address.")
        }
        url = address
    }
}
