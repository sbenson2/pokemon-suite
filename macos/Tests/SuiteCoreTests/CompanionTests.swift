import XCTest
@testable import SuiteCore

final class CompanionTests: XCTestCase {
    func testCompanionFollowsTheMacSelectionAndFallsBackToItsRunningGame() throws {
        func state(_ json:String)throws->JSONValue {try JSONDecoder().decode(JSONValue.self,from:Data(json.utf8))}
        let selected=try state("""
        {"library":[{"id":"firered"},{"id":"emerald"}],"session":{"game":"emerald"},"sessions":[{"game":"firered","state":"running","sessionId":"red"}]}
        """)
        XCTAssertEqual(CompanionSelection.game(in:selected),"emerald")
        var missing=selected;missing["session"] = .null
        XCTAssertEqual(CompanionSelection.game(in:missing),"firered")
        missing["sessions"] = .array([.object(["game":.string("firered"),"state":.string("closed"),"sessionId":.string("old")])])
        XCTAssertNil(CompanionSelection.game(in:missing))
        var absent=selected;absent["session"] = .object(["game":.string("unknown")])
        XCTAssertEqual(CompanionSelection.game(in:absent),"firered")
    }
    func testRemoteStatusRefreshUsesABoundedCellularRequestWithoutShorteningCommands() async throws {
        let api=SuiteAPI(baseURL:URL(string:"https://100.101.102.103:55443")!,bearerToken:"secret",certificateSHA256:String(repeating:"b",count:64))
        let status=try await api.request("/api/state"),command=try await api.request("/api/pokemon-suite/save",body:.object(["game":.string("firered")]))
        XCTAssertTrue(status.allowsCellularAccess)
        XCTAssertLessThanOrEqual(status.timeoutInterval,10)
        XCTAssertGreaterThanOrEqual(command.timeoutInterval,120)
    }
    func testConnectionCodeRejectsUntrustedTransportAndMalformedCredentials() throws {
        let valid = "{\"version\":1,\"name\":\"My Mac\",\"url\":\"https://192.168.1.10:55443\",\"token\":\"" + String(repeating: "a", count: 64) + "\",\"certificateSHA256\":\"" + String(repeating: "b", count: 64) + "\"}"
        let pairing = try SuitePairing(code: valid)
        XCTAssertEqual(pairing.url.host, "192.168.1.10")
        XCTAssertEqual(try SuitePairing(code: pairing.code), pairing)
        for bad in [valid.replacingOccurrences(of: "https:", with: "http:"), valid.replacingOccurrences(of: "192.168.1.10:55443", with: "user:password@192.168.1.10:55443"), valid.replacingOccurrences(of: String(repeating: "b", count: 64), with: "bad"), valid.replacingOccurrences(of: "55443", with: "55443/unexpected")] {
            XCTAssertThrowsError(try SuitePairing(code: bad))
        }
    }
    func testRemoteRequestsCannotSendCredentialsToAnotherHost() async throws {
        let api = SuiteAPI(baseURL: URL(string: "https://192.168.1.10:55443")!, bearerToken: "secret", certificateSHA256: String(repeating:"b",count:64))
        let request = try await api.request("/api/pokemon-suite/save", body: .object(["game":.string("firered")]))
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer secret")
        XCTAssertNil(request.value(forHTTPHeaderField: "Origin"))
        XCTAssertNil(request.value(forHTTPHeaderField: "Cookie"))
        do { _ = try await api.request("https://other.invalid/api/state"); XCTFail("Credentials must stay on the paired Mac") } catch {}
    }
}
