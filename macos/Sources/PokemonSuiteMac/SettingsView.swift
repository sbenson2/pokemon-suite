import AppKit
import SwiftUI
import SuiteCore

struct SuiteSettingsView: View {
    @EnvironmentObject var model: SuiteModel
    @AppStorage("appearance") private var appearance = "system"
    @AppStorage("settingsPane") private var pane = "General"
    var body: some View {
        TabView(selection: $pane) {
            Form {
                Section {
                    Picker("Appearance", selection: $appearance) {
                        Text("System").tag("system")
                        Text("Light").tag("light")
                        Text("Dark").tag("dark")
                    }.pickerStyle(.segmented)
                }
                Section("Windows and games") {
                    LabeledContent("Close window", value: "Keep games running")
                    LabeledContent("Quit app", value: "Save and close games")
                }
            }.formStyle(.grouped)
                .tabItem { Label("General", systemImage: "gearshape") }.tag("General")
            Form {
                Section("Library folder") {
                    Text(model.profile.path).textSelection(.enabled).foregroundStyle(.secondary).lineLimit(2).truncationMode(.middle).help(model.profile.path)
                    HStack {
                        Button("Open Library…", action: model.chooseProfile)
                        Button("Show in Finder") { NSWorkspace.shared.selectFile(nil, inFileViewerRootedAtPath: model.profile.path) }
                    }.disabled(model.busy)
                }
                Section("Games") {
                    Button("Choose ROM Folder…", action: model.chooseROMFolder).disabled(model.busy || model.api == nil)
                    Button("Add FireRed…", action: model.addFireRed).disabled(model.busy || model.api == nil)
                    Button("Rescan Games") {
                        model.perform { try await model.api?.post("/api/pokemon-suite/scan-library"); model.notice = "Library refreshed." }
                    }.disabled(model.busy || model.api == nil)
                }
                Section {
                    DisclosureGroup("Artwork support") { ArtworkCoverage(game: model.selectedGame) }
                }
            }.formStyle(.grouped)
                .tabItem { Label("Library", systemImage: "externaldrive") }.tag("Library")
            CompanionSettingsView(host: model.companion)
                .tabItem { Label("Companion", systemImage: "desktopcomputer.and.iphone") }.tag("Companion")
            SoftwareUpdatesView()
                .tabItem { Label("Updates", systemImage: "arrow.down.circle") }.tag("Updates")
            Form {
                Section("Support") {
                    Button("Pokémon Suite Help", action: model.openHelp)
                    Button("Export Status Report…", action: model.exportReport)
                    Button("Open in Browser", action: model.openCompleteSuite).disabled(model.api == nil)
                }
                Section("Service status") {
                    LabeledContent("Local service", value: model.starting ? "Starting…" : model.api == nil ? "Unavailable" : model.state["diagnostics"]["status"].text)
                    ForEach(Array(model.state["diagnostics"]["issues"].array.enumerated()), id: \.offset) { _, issue in Text(issue.string).foregroundStyle(.secondary) }
                }
                Section("Credits and licenses") {
                    Text("App code: MIT. Cartridge models: CC BY 4.0. mGBA core: MPL-2.0.").font(.callout)
                    LicenseLinks(open: openResource)
                }
            }.formStyle(.grouped)
                .tabItem { Label("Support", systemImage: "questionmark.circle") }.tag("Support")
        }
        .frame(width: 580, height: pane == "General" ? 270 : pane == "Library" ? 420 : pane == "Updates" ? 600 : 460)
        .navigationTitle(pane)
        .preferredColorScheme(appearance == "light" ? .light : appearance == "dark" ? .dark : nil)
    }
    func openResource(_ path: String) {
        if let url = Bundle.main.resourceURL?.appendingPathComponent(path) { NSWorkspace.shared.open(url) }
    }
}

/// License and credit files inside the app bundle. One row when it fits the
/// pane, otherwise two, so no title is cut off.
struct LicenseLinks: View {
    struct Destination { let title: String; let path: String }
    let open: (String) -> Void
    let destinations = [
        Destination(title: "Third-Party Notices", path: "Suite/THIRD_PARTY_NOTICES.md"),
        Destination(title: "Cartridge Credits", path: "Suite/licenses/cartridge-models/README.md"),
        Destination(title: "Emulator License", path: "GameResources/licenses/mgba/README.md"),
        Destination(title: "Runtime Licenses", path: "Runtime"),
    ]
    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack { buttons(destinations) }
            twoRows
        }
    }
    var twoRows: some View {
        VStack(alignment: .leading) {
            HStack { buttons(Array(destinations.prefix(2))) }
            HStack { buttons(Array(destinations.suffix(2))) }
        }
    }
    private func buttons(_ list: [Destination]) -> some View {
        ForEach(list, id: \.title) { destination in Button(destination.title) { open(destination.path) } }
    }
}
