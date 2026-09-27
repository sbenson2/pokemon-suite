import SwiftUI
import SuiteCore

struct SpeciesChooser: View {
    @EnvironmentObject var model: SuiteModel
    @Environment(\.dismiss) private var dismiss
    @Binding var selection: Int
    @State private var search = ""
    @State private var candidate: Int?
    var filtered: [JSONValue] { model.species.filter { search.isEmpty || $0["name"].string.localizedCaseInsensitiveContains(search) || $0["id"].text == search } }
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Choose a Pokémon").font(.title2)
            TextField("Search by name or Pokédex number", text: $search).textFieldStyle(.roundedBorder)
                .accessibilityLabel("Search Pokémon")
            List(selection: $candidate) {
                ForEach(filtered, id: \.gameID) { pokemon in
                    Button { candidate = pokemon["id"].int } label: {
                        HStack {
                            ROMSprite(id: pokemon["id"].int, size: 40).accessibilityHidden(true)
                            Text(pokemon["name"].string)
                            Spacer()
                            Text(String(format: "%03d", pokemon["id"].int)).foregroundStyle(.secondary).monospacedDigit()
                        }.contentShape(Rectangle())
                    }.buttonStyle(.plain).tag(pokemon["id"].int)
                }
            }.listStyle(.inset).overlay { Rectangle().stroke(.separator, lineWidth: 1).allowsHitTesting(false) }
                .overlay { if filtered.isEmpty { ContentUnavailableView.search(text: search) } }
            HStack {
                Text(model.title).font(.callout).foregroundStyle(.secondary)
                Spacer()
                Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction)
                Button("Choose") { if let candidate { selection = candidate; dismiss() } }
                    .keyboardShortcut(.defaultAction).disabled(candidate == nil)
            }
        }.padding(20).suiteSheetSize(width: 450, height: 510)
        .onAppear { candidate = selection }
    }
}
