# Thriller Part 4.fbx（Mixamo の人物 ＋ ダンスのアニメーション）をブラウザ用の GLB に書き出す
# 使い方（FBX のパスは環境に合わせて変える）:
#   blender -b --python tools/export_thriller.py -- "C:/Users/yyy20/Downloads/Thriller Part 4.fbx"
#   npx -y @gltf-transform/cli@4 meshopt web/_thriller-raw.glb web/yogibo-dancer.glb     # 見た目を変えない圧縮
#   （圧縮したら web/_thriller-raw.glb は消してよい）
# 人物の形・骨格・アニメーション（1〜1113フレーム、30fps）はそのまま。軽量化はしない。
import bpy, os, sys

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
fbx = args[0] if args else r"C:/Users/yyy20/Downloads/Thriller Part 4.fbx"
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "web", "_thriller-raw.glb")

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=fbx)

# アニメーションの範囲に、書き出しの範囲を合わせる（読み込み直後は 1〜250 になっている）
action = bpy.data.actions[0]
start, end = int(action.frame_range[0]), int(action.frame_range[1])
scene = bpy.context.scene
scene.frame_start, scene.frame_end = start, end
print('ANIMATION', action.name, start, end, 'fps', scene.render.fps)

bpy.ops.export_scene.gltf(
    filepath=out, export_format='GLB', export_yup=True,
    export_materials='NONE', export_cameras=False, export_lights=False,
    export_animations=True, export_frame_range=True,
)
print('EXPORTED', os.path.getsize(out), 'bytes')
