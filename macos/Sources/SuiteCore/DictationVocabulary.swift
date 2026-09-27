import Foundation

/// Hints for on-device dictation (`SFSpeechRecognitionRequest.contextualStrings`):
/// names the recognizer would otherwise mishear ("muse two", "sin a bar"). The
/// live party (species and nicknames) and hunt target come first, then command
/// words and FireRed places. Each is a spelling the host's interpreter reads
/// (tests/test_voice_request_packaging.py), so a hint never steers a transcript
/// into text the Suite cannot parse. Apple allows no more than 100 phrases.
public enum DictationVocabulary {
    public static let limit = 100
    /// Game terms, not everyday words ("Eevee" is left out: it pulls "EV" toward Eevee).
    public static let commands = ["Pokémon Center", "Poké Ball", "Great Ball", "Ultra Ball", "Master Ball", "Rare Candy", "Exp Share", "Silph Scope",
                                  "shiny", "EV train", "EVs", "IVs", "Hidden Power", "Sweet Scent", "save the game", "new save", "pause the bot",
                                  "stop the bot", "start the bot", "resume", "heal the team", "route", "buy", "postgame", "National Pokédex", "trade"]
    public static let places = ["Pallet Town", "Viridian City", "Pewter City", "Cerulean City", "Vermilion City", "Lavender Town", "Celadon City",
                                "Fuchsia City", "Saffron City", "Cinnabar Island", "Indigo Plateau", "Viridian Forest", "Mt. Moon", "Rock Tunnel",
                                "Diglett's Cave", "Pokémon Tower", "Power Plant", "Safari Zone", "Seafoam Islands", "Pokémon Mansion", "Silph Co.",
                                "S.S. Anne", "Rocket Hideout", "Victory Road", "Cerulean Cave", "One Island", "Two Island", "Three Island", "Four Island",
                                "Five Island", "Six Island", "Seven Island", "Mt. Ember", "Berry Forest", "Navel Rock", "Birth Island"]

    /// `session` is the game's `/api/state` session; `species` the Pokédex catalog
    /// (`dex.species`, optional) names a hunt target the session gives only by number.
    public static func phrases(session: JSONValue, species: [JSONValue] = []) -> [String] {
        let spectator = session["spectator"]["party"].array
        let party = (spectator.isEmpty ? session["observation"]["party"].array : spectator).flatMap { [$0["speciesName"].string.nonempty ?? $0["name"].string, $0["nickname"].string] }
        let targets = [session["mission"], session["pendingHunt"]].map { hunt -> String in
            species.first { $0["id"] == hunt["speciesId"] && !hunt["speciesId"].isNull }?["name"].string.nonempty ?? hunt["name"].string.capitalized
        }
        var seen = Set<String>()
        return Array((party + targets + commands + places).compactMap { raw -> String? in
            let phrase = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            return !phrase.isEmpty && seen.insert(phrase.lowercased()).inserted ? phrase : nil
        }.prefix(limit))
    }
}
