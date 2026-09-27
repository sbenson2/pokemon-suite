"""Exercise the native scene factory with real bundled meshes, without a game owner."""
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


@unittest.skipUnless(sys.platform == 'darwin' and shutil.which('swift'), 'Native SceneKit requires macOS')
class CartridgeModelTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.workspace = tempfile.TemporaryDirectory(prefix='suite-cartridge-models-')
        cls.addClassCleanup(cls.workspace.cleanup)
        cls.root = Path(cls.workspace.name)
        shutil.copytree(ROOT/'macos/Sources/SuiteCore', cls.root/'Sources/SuiteCore')
        probe = cls.root/'Sources/Probe'; probe.mkdir()
        scene = ROOT/'macos/Sources/PokemonSuiteMac/CartridgeScene.swift'
        shutil.copyfile(scene, probe/'CartridgeScene.swift')
        models = ROOT/'macos/Sources/PokemonSuiteMac/CartridgeModels.swift'
        shutil.copyfile(models, probe/models.name)
        cls.assets = cls.root/'Assets/Cartridges'
        if (ROOT/'macos/Assets/Cartridges').exists():
            shutil.copytree(ROOT/'macos/Assets/Cartridges', cls.assets)
        (cls.root/'Package.swift').write_text('''// swift-tools-version: 6.0
import PackageDescription
let package = Package(name: "CartridgeModelTest", platforms: [.macOS(.v14)], targets: [.target(name: "SuiteCore"), .executableTarget(name: "Probe", dependencies: ["SuiteCore"])], swiftLanguageModes: [.v5])
''')
        (probe/'Probe.swift').write_text('''import AppKit
import SceneKit
import SuiteCore
@main struct Probe {
    @MainActor static func main() throws {
        _ = NSApplication.shared
        func scene(_ id: String, _ platform: String) -> SCNScene {
            CartridgeMesh.scene(style: CartridgeStyle(game: .object(["id":.string(id),"label":.string(id),"platform":.string(platform)])), artwork:nil, logo:nil)
        }
        func materials(_ s: SCNScene) -> [SCNMaterial] {
            var result:[SCNMaterial]=[]
            s.rootNode.enumerateChildNodes { n,_ in result += n.geometry?.materials ?? [] }
            return result
        }
        func rgb(_ m: SCNMaterial?) -> [Double] {
            guard let c=(m?.diffuse.contents as? NSColor)?.usingColorSpace(.sRGB) else { return [] }
            return [Double(c.redComponent),Double(c.greenComponent),Double(c.blueComponent)]
        }
        let red=scene("red","gb")
        let redMaterial=materials(red).first { $0.name=="suite_shell" }
        let before=rgb(redMaterial)
        let blue=scene("blue","gb")
        var rows:[[String:Any]]=[]
        for (id,platform) in [("red","gb"),("gold","gbc"),("crystal","gbc"),("firered","gba"),("diamond","nds"),("x","3ds"),("violet","switch")] {
            let s=scene(id,platform)
            let node=s.rootNode.childNode(withName:"imported-shell",recursively:true)
            var triangles=0
            node?.enumerateChildNodes { n,_ in triangles += (n.geometry?.elements ?? []).reduce(0) { $0 + $1.primitiveCount } }
            let ms=materials(s)
            rows.append(["game":id,"imported":node != nil,"triangles":triangles,
                         "board":ms.contains { $0.name=="suite_board" },
                         "transparent":ms.contains { $0.name=="suite_clear_shell" && $0.transparency < 1 },
                         "children":s.rootNode.childNodes.count])
        }
        let result:[String:Any]=["models":rows,"redBefore":before,"redAfter":rgb(redMaterial),"blue":rgb(materials(blue).first { $0.name=="suite_shell" })]
        print(String(data:try JSONSerialization.data(withJSONObject:result,options:[.sortedKeys]),encoding:.utf8)!)
    }
}
''')
        r = subprocess.run(['swift','build','--package-path',str(cls.root)], capture_output=True, text=True, timeout=120)
        if r.returncode: raise RuntimeError(r.stderr)
        cls.executable = cls.root/'.build/debug/Probe'

    def inspect(self):
        r = subprocess.run([str(self.executable)], capture_output=True, text=True, timeout=30)
        self.assertEqual(r.returncode, 0, r.stderr)
        return json.loads(r.stdout.strip().splitlines()[-1])

    def test_every_cartridge_family_renders_its_imported_mesh(self):
        for model in self.inspect()['models']:
            with self.subTest(game=model['game']):
                self.assertTrue(model['imported'], 'The native scene fell back instead of loading its bundled model')
                self.assertGreater(model['triangles'], 100)
                self.assertLess(model['triangles'], 20000)

    def test_crystal_has_a_visible_interior_and_translucent_case(self):
        crystal = next(x for x in self.inspect()['models'] if x['game']=='crystal')
        self.assertTrue(crystal['board'])
        self.assertTrue(crystal['transparent'])

    def test_cached_mesh_materials_do_not_change_other_games(self):
        result = self.inspect()
        self.assertEqual(len(result['redBefore']), 3)
        self.assertEqual(result['redBefore'], result['redAfter'])
        self.assertNotEqual(result['redAfter'], result['blue'])

    def test_missing_mesh_keeps_a_renderable_fallback(self):
        mesh = self.assets/'gba.obj'
        if not mesh.exists(): self.skipTest('No mesh exists to remove')
        data = mesh.read_bytes(); mesh.unlink()
        try:
            row=next(x for x in self.inspect()['models'] if x['game']=='firered')
            self.assertFalse(row['imported'])
            self.assertGreater(row['children'], 0)
        finally: mesh.write_bytes(data)
