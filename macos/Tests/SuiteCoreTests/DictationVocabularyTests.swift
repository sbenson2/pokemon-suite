import XCTest
@testable import SuiteCore

/// Hints for on-device dictation (`contextualStrings`): the live party and hunt
/// target first, then command words and FireRed places, never more than Apple's 100.
final class DictationVocabularyTests: XCTestCase {
    private func json(_ text: String) -> JSONValue { try! JSONDecoder().decode(JSONValue.self, from: Data(text.utf8)) }

    func testThePartyAndTheHuntTargetComeFirst() {
        // The request-context session: spectator party with a nicknamed Dragonite, hunting Slugma.
        let session = json(#"{"spectator":{"party":[{"slot":0,"speciesId":22,"speciesName":"Fearow"},{"slot":1,"speciesId":55,"speciesName":"Golduck"},{"slot":2,"speciesId":149,"speciesName":"Dragonite","nickname":"Drake"}]},"mission":{"name":"slugma","speciesId":218,"state":"running"}}"#)
        let phrases = DictationVocabulary.phrases(session: session)
        XCTAssertEqual(Array(phrases.prefix(5)), ["Fearow", "Golduck", "Dragonite", "Drake", "Slugma"])
        for expected in ["EV train", "IVs", "Ultra Ball", "Master Ball", "Pokémon Center", "Cinnabar Island", "Pewter City", "Mt. Moon", "Seafoam Islands"] {
            XCTAssertTrue(phrases.contains(expected), expected)
        }
        XCTAssertLessThanOrEqual(phrases.count, DictationVocabulary.limit)
        XCTAssertEqual(DictationVocabulary.limit, 100, "Apple: no more than 100 phrases")
    }

    func testTheCatalogNamesATargetGivenOnlyByNumber() {
        let session = json(#"{"pendingHunt":{"speciesId":150},"observation":{"party":[{"slot":0,"speciesId":25,"name":"Pikachu"}]}}"#)
        let catalog = json(#"[{"id":150,"name":"Mewtwo"},{"id":25,"name":"Pikachu"}]"#).array
        XCTAssertEqual(Array(DictationVocabulary.phrases(session: session, species: catalog).prefix(2)), ["Pikachu", "Mewtwo"],
                       "the observed party stands in when the spectator has none")
        XCTAssertEqual(DictationVocabulary.phrases(session: json(#"{"mission":{"speciesId":150}}"#)).first, DictationVocabulary.commands.first,
                       "an unnamed target without a catalog adds nothing")
    }

    func testWithoutAGameTheCommandsAndPlacesRemainOnceEach() {
        let phrases = DictationVocabulary.phrases(session: .null)
        XCTAssertEqual(phrases, Array((DictationVocabulary.commands + DictationVocabulary.places).prefix(DictationVocabulary.limit)))
        XCTAssertEqual(Set(phrases.map { $0.lowercased() }).count, phrases.count)
        let echo = json(#"{"spectator":{"party":[{"speciesName":"Pikachu","nickname":"PIKACHU"},{"speciesName":"Pikachu"},{"speciesName":" "}]}}"#)
        XCTAssertEqual(DictationVocabulary.phrases(session: echo).filter { $0.lowercased() == "pikachu" }.count, 1, "a nickname that repeats the species is one hint")
        XCTAssertFalse(DictationVocabulary.phrases(session: echo).contains { $0.trimmingCharacters(in: .whitespaces).isEmpty })
    }

    func testNeverMoreThanAHundredAndTheLiveNamesSurvive() {
        let crowd = (1...120).map { #"{"speciesName":"Mon\#($0)"}"# }.joined(separator: ",")
        let phrases = DictationVocabulary.phrases(session: json(#"{"spectator":{"party":[\#(crowd)]}}"#))
        XCTAssertEqual(phrases.count, 100)
        XCTAssertEqual(phrases.first, "Mon1")
    }

    func testEveryHintIsASpellingTheInterpreterReads() {
        // Hints steer what the recognizer writes, so each must parse on the host
        // (checked there: "Exp Share", not "Poké Mart" or "PC box", which it does not read).
        for phrase in DictationVocabulary.commands + DictationVocabulary.places {
            XCTAssertFalse(phrase.isEmpty)
            XCTAssertLessThanOrEqual(phrase.split(separator: " ").count, 3, phrase)
        }
        XCTAssertFalse(DictationVocabulary.commands.contains("Eevee"), "an Eevee hint pulls “EV” toward Eevee (voice audit)")
    }
}
