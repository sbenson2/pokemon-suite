import AppKit
import SwiftUI
import SuiteCore

@main
struct PokemonSuiteApp: App {
    @NSApplicationDelegateAdaptor(SuiteAppDelegate.self) private var delegate
    @StateObject private var model = SuiteModel()
    @StateObject private var appUpdater = AppUpdater()
    var body: some Scene {
        Window("Pokémon Suite", id: "suite") {
            SuiteWindow().environmentObject(model).environmentObject(appUpdater)
                .frame(minWidth: 1100, minHeight: 680)
                .background(MainWindowIdentity())
                .task { delegate.model = model; appUpdater.model = model; await model.launch() }
        }
        .defaultSize(width: 1280, height: 840)
        .windowResizability(.contentMinSize)
        .commands {
            CommandGroup(replacing: .newItem) {
                Button("Open Library…", action: model.chooseProfile).keyboardShortcut("o")
                Button("Add FireRed…", action: model.addFireRed)
            }
            CommandGroup(after: .appInfo) {
                Button("Check for Updates…", action: appUpdater.check).disabled(!appUpdater.available)
            }
            CommandMenu("Game") {
                Button("Start Game", action: model.startGame).disabled(!model.installed || model.gameRunning || model.busy)
                Button("Stop Game", action: model.stopGame).disabled(!model.gameRunning || model.busy)
                Button("Save Game", action: model.saveGame).keyboardShortcut("s").disabled(!model.gameRunning || model.busy)
                Button(model.manual ? "End Manual Play" : "Manual Play") { model.setManual(!model.manual); model.page = .live }
                    .disabled(!model.gameRunning || model.busy)
                Divider()
                Button("Bot Settings") { model.page = .bot }
                Button("Export Status Report…", action: model.exportReport)
                Button("Open in Browser", action: model.openCompleteSuite).disabled(model.api == nil)
            }
            SidebarCommands()
            CommandGroup(after: .sidebar) {
                ForEach(Array(SuitePage.allCases.enumerated()), id: \.element.id) { index, page in
                    Button(page.rawValue) { model.page = page }
                        .keyboardShortcut(KeyEquivalent(Character(String(index + 1))))
                }
            }
            CommandGroup(replacing: .help) {
                Button("Pokémon Suite Help", action: model.openHelp)
            }
        }
        Settings {
            SuiteSettingsView().environmentObject(model).environmentObject(appUpdater)
        }
    }
}

struct MainWindowIdentity: NSViewRepresentable {
    func makeNSView(context: Context) -> NSView { let view = NSView(); DispatchQueue.main.async { view.window?.identifier = NSUserInterfaceItemIdentifier("suite") }; return view }
    func updateNSView(_ view: NSView, context: Context) {}
}

@MainActor final class SuiteAppDelegate: NSObject, NSApplicationDelegate {
    weak var model: SuiteModel?
    private var terminating = false
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag { sender.windows.first { $0.identifier?.rawValue == "suite" }?.makeKeyAndOrderFront(nil) }
        return true
    }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard let model else { return .terminateNow }
        guard !terminating else { return .terminateCancel }
        terminating = true
        Task {
            do { try await model.quitService(); sender.reply(toApplicationShouldTerminate: true) }
            catch {
                terminating = false
                let alert = NSAlert(); alert.messageText = "Pokémon Suite is still open"; alert.informativeText = error.localizedDescription
                alert.addButton(withTitle: "Keep Open"); alert.runModal()
                sender.reply(toApplicationShouldTerminate: false)
            }
        }
        return .terminateLater
    }
}

struct SuiteWindow: View {
    @EnvironmentObject var model: SuiteModel
    @AppStorage("appearance") private var appearance = "system"
    var body: some View {
        NavigationSplitView {
            List(selection: $model.page) {
                ForEach(SuitePage.allCases) { page in
                    Button { model.page = page } label: {
                        Label(page.rawValue, systemImage: page.symbol).frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
                    }.buttonStyle(.plain).accessibilityLabel(page.rawValue).accessibilityIdentifier("navigation-" + page.id).tag(page)
                }
            }
                .navigationSplitViewColumnWidth(min: 170, ideal: 190, max: 250)

        } detail: {
            VStack(spacing: 0) {
                if model.starting {
                    VStack(spacing: 14) { ProgressView(); Text("Opening your library…").foregroundStyle(.secondary) }.frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if model.api == nil {
                    ContentUnavailableView {
                        Label("Library couldn’t open", systemImage: "externaldrive.badge.exclamationmark")
                    } description: { Text(model.error ?? "The app’s local service is unavailable.") }
                    actions: { Button("Try Again") { Task { await model.launch() } }; Button("Open Library…", action: model.chooseProfile) }
                } else {
                    switch model.page {
                    case .library: LibraryView()
                    case .live: LiveView(playback: model.playback)
                    case .pokedex: PokedexView()
                    case .farming: FarmingView()
                    case .trading: TradingView()
                    case .bot: BotView()
                    }
                }
                if let notice = model.notice {
                    HStack(alignment: .top, spacing: 12) {
                        Label(notice, systemImage: "info.circle").font(.callout).textSelection(.enabled)
                        Spacer(minLength: 0)
                        Button { model.notice = nil } label: { Image(systemName: "xmark") }
                            .buttonStyle(.borderless).accessibilityLabel("Dismiss message").help("Dismiss this message")
                    }.padding(12).background(.bar).overlay(alignment: .top) { Divider() }
                }
            }
            .navigationTitle(model.page.rawValue)
            .toolbar {
                if model.page != .library {
                    ToolbarItem(placement: .principal) {
                    Picker("Selected game", selection: Binding(get: { model.selectedGame }, set: { id in Task { await model.selectGame(id) } })) {
                        ForEach(model.games, id: \.gameID) { game in Text(game["title"].string).tag(game["id"].string) }
                    }.frame(maxWidth: 260).disabled(model.busy || model.starting)
                        .help("Choose the game for this view").accessibilityIdentifier("selected-game")
                    }
                }
                ToolbarItem { if model.busy { ProgressView("Working…").labelsHidden().controlSize(.small).accessibilityLabel("Working") } }
            }
        }
        .preferredColorScheme(appearance == "light" ? .light : appearance == "dark" ? .dark : nil)
        .onChange(of: model.page) { _, page in UserDefaults.standard.set(page.rawValue, forKey: "selectedPage") }
        .alert("Action couldn’t finish", isPresented: Binding(get: { model.error != nil && model.api != nil }, set: { if !$0 { model.error = nil } })) {
            Button("OK") { model.error = nil }
        } message: { Text(model.error ?? "") }
    }
}

extension JSONValue {
    var gameID: String { self["id"].text }
    var label: String { self["name"].string.nonempty ?? self["label"].string.nonempty ?? self["id"].text }
}

struct Panel<Content: View>: View {
    let title: String
    @ViewBuilder var content: Content
    var body: some View {
        GroupBox {
            VStack(alignment: .leading, spacing: 12) { content }.frame(maxWidth: .infinity, alignment: .leading).padding(8)
        } label: { Text(title).font(.headline) }
    }
}

struct BorderedScroll<Content: View>: View {
    @ViewBuilder var content: Content
    var body: some View {
        ScrollView { content.padding(16).frame(maxWidth: .infinity, alignment: .leading) }
            .scrollIndicators(.visible).scrollBounceBehavior(.basedOnSize)
            .overlay { Rectangle().stroke(.separator, lineWidth: 1).allowsHitTesting(false) }
    }
}

struct SectionTabs: View {
    let label: String
    let items: [String]
    @Binding var selection: String
    var body: some View {
        Picker(label, selection: $selection) { ForEach(items, id: \.self) { Text($0).tag($0) } }
            .pickerStyle(.segmented).labelsHidden().padding(12)
    }
}

struct InfoButton: View {
    let title: String
    let message: String
    @State private var showing = false
    var body: some View {
        Button { showing.toggle() } label: { Image(systemName: "info.circle") }
            .buttonStyle(.borderless).help(title).accessibilityLabel(title)
            .popover(isPresented: $showing) {
                VStack(alignment: .leading, spacing: 10) {
                    Text(title).font(.headline)
                    Text(message).font(.callout).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
                }.padding(16).frame(width: 300)
            }
    }
}

/// Keep both internal scroll regions within the window when native forms change intrinsic size.
struct SuiteSplit<Leading: View, Trailing: View>: View {
    var leadingFraction: CGFloat
    @ViewBuilder var leading: Leading
    @ViewBuilder var trailing: Trailing
    var body: some View {
        GeometryReader { geometry in
            let width = max(0, geometry.size.width - 1)
            HStack(spacing: 0) {
                leading.frame(width: width * leadingFraction, height: geometry.size.height)
                Divider()
                trailing.frame(width: width * (1 - leadingFraction), height: geometry.size.height)
            }
        }
    }
}

extension View {
    func suiteSheetSize(width: CGFloat, height: CGFloat? = nil) -> some View { self.frame(width: width, height: height) }
    func suiteConfigurationPicker() -> some View { self.pickerStyle(.segmented) }
}
