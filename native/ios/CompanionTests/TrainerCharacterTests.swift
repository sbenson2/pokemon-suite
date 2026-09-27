import XCTest
import SuiteCore
@testable import PokemonSuiteCompanion

final class TrainerCharacterTests: XCTestCase {
    func testFemaleAndMaleObservationsChooseTheirRespectiveROMResource() {
        for gender: JSONValue in [.string("GIRL"), .number(1), .string("female")] {
            XCTAssertEqual(TrainerCharacter(gender: gender).key, "female")
        }
        for gender: JSONValue in [.string("BOY"), .number(0), .string("male")] {
            XCTAssertEqual(TrainerCharacter(gender: gender).key, "male")
        }
    }
    func testUnrecognizedOrAbsentCharacterDoesNotInventAMaleTrainer() {
        for gender: JSONValue in [.null, .bool(false), .number(2), .string(""), .string("unknown")] {
            XCTAssertNil(TrainerCharacter(gender: gender).key)
        }
    }
}
