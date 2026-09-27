import XCTest
@testable import SuiteCore

final class PokedexFilterTests: XCTestCase {
    func testRegionalDexUsesItsOwnNumbersAndKeepsOutNationalOnlySpecies() throws {
        let species = try JSONDecoder().decode(JSONValue.self, from: Data(#"[{"id":1,"name":"Bulbasaur","regionalNumber":null,"types":["grass"],"encounters":[]},{"id":252,"name":"Treecko","regionalNumber":1,"types":["grass"],"encounters":[{"location":"Littleroot Town"}]},{"id":230,"name":"Kingdra","regionalNumber":186,"types":["water","dragon"],"encounters":[]}]"#.utf8)).array
        var filter = PokedexFilter(scope: "regional")
        XCTAssertEqual(filter.apply(to: species).map { $0["id"].int }, [252, 230])
        filter.query = "186"
        XCTAssertEqual(filter.apply(to: species).map { $0["name"].string }, ["Kingdra"])
        filter.scope = "national"; filter.query = ""; filter.type = "grass"
        XCTAssertEqual(filter.apply(to: species).map { $0["id"].int }, [1, 252])
        filter.availability = "encounter"
        XCTAssertEqual(filter.apply(to: species).map { $0["id"].int }, [252])
        filter.query = "littleroot"
        XCTAssertEqual(filter.apply(to: species).count, 1)
    }
}
