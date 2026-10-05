import Foundation
import Combine
import Sparkle
import SuiteCore

@MainActor final class AppUpdater: NSObject, ObservableObject, SPUUpdaterDelegate {
    weak var model: SuiteModel?
    private var pendingInstall: (() -> Void)?
    private var controller: SPUStandardUpdaterController?
    @Published private(set) var available = false
    @Published private(set) var message = "This version doesn’t update itself. Download new versions from the project’s Releases page on GitHub."
    override init() {
        super.init()
        guard let feed = Bundle.main.object(forInfoDictionaryKey: "SUFeedURL") as? String,
              URL(string: feed)?.scheme == "https",
              let key = Bundle.main.object(forInfoDictionaryKey: "SUPublicEDKey") as? String,
              Data(base64Encoded: key)?.count == 32 else { return }
        controller = SPUStandardUpdaterController(startingUpdater: true, updaterDelegate: self, userDriverDelegate: nil)
        available = true
        message = "App updates replace the native interface and bundled runtimes. Pokémon Suite saves and closes game owners before quitting; unfinished trades keep it open."
    }
    func check() {
        if pendingInstall != nil { finishGamesBeforeInstall() }
        else { controller?.checkForUpdates(nil) }
    }
    func updater(_ updater: SPUUpdater, shouldPostponeRelaunchForUpdate item: SUAppcastItem, untilInvokingBlock installHandler: @escaping () -> Void) -> Bool {
        pendingInstall = installHandler
        finishGamesBeforeInstall()
        return true
    }
    private func finishGamesBeforeInstall() {
        Task {
            do {
                guard let model else { throw SuiteError("Open the library before applying the app update.") }
                try await model.quitService()
                let install = pendingInstall; pendingInstall = nil; install?()
            } catch {
                message = "Update is waiting: " + error.localizedDescription + " Finish the game’s pending transaction, then choose Check for Updates again."
            }
        }
    }
}
