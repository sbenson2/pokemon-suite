import XCTest
@testable import SuiteCore

final class PCInventoryTests: XCTestCase {
    private func pokemon(_ json: String) throws -> JSONValue { try JSONDecoder().decode(JSONValue.self, from: Data(json.utf8)) }
    func testShinyAndTypeFiltersKeepOnlyOwnedIndividualsInTheSelectedBox() throws {
        let mon = try pokemon(#"{"name":"Pikachu","nationalSpeciesId":25,"shiny":true,"types":["electric"],"location":{"kind":"box","box":2,"slot":29}}"#)
        var filter = PCInventoryFilter(); filter.appearance = "shiny"; filter.type = "electric"; filter.location = "2"
        XCTAssertTrue(filter.includes(mon))
        filter.location = "1"; XCTAssertFalse(filter.includes(mon))
        filter.location = "all"; filter.type = "water"; XCTAssertFalse(filter.includes(mon))
        filter.type = "all"; filter.appearance = "normal"; XCTAssertFalse(filter.includes(mon))
    }
    func testSearchMatchesSpeciesNumberAndNicknameWithoutConfusingPartyWithBoxZero() throws {
        let mon = try pokemon(#"{"name":"Mr. Mime","nickname":"Marcel","nationalSpeciesId":122,"shiny":false,"types":["psychic"],"location":{"kind":"party","slot":0}}"#)
        var filter = PCInventoryFilter(); filter.query = "MARCEL"; filter.location = "party"
        XCTAssertTrue(filter.includes(mon)); filter.query = "122"; XCTAssertTrue(filter.includes(mon))
        filter.location = "0"; XCTAssertFalse(filter.includes(mon))
        filter.location = "party"; filter.query = "Pikachu"; XCTAssertFalse(filter.includes(mon))
    }
}
