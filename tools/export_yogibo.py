# yogibo.blend をブラウザ用に書き出す（.blend は保存しない）
# 使い方: blender -b yogibo.blend --python tools/export_yogibo.py
#  - ランニングマシンを軽量化して web/yogibo.glb に書き出す
#  - 走る人物は、元の Meshy_AI_Office_T_Pose_Running.glb をそのまま使う（web/yogibo-runner.glb。見た目とアニメーションを変えないため）
#    ここでは、yogibo.blend での人物の置き場所（target_character の位置・向き）だけを web/yogibo-room.json に書き出す
#  - glTF_not_exported コレクションの補助物（球体）、カメラ、ライトは書き出さない
import bpy, json, os

WEB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "web")
TARGET_FACES = 8000

# 人物の置き場所（Blender の Z上 → ブラウザの Y上 に変換: (x, y, z) → (x, z, -y)）
rig = bpy.data.objects.get('target_character')
if rig:
    loc, rot = rig.matrix_world.translation, rig.matrix_world.to_euler()
    room = {'runner': {'position': [round(loc.x, 4), round(loc.z, 4), round(-loc.y, 4)], 'rotationY': round(rot.z, 4)}}
    with open(os.path.join(WEB, 'yogibo-room.json'), 'w', encoding='utf-8') as f:
        json.dump(room, f, ensure_ascii=False, indent=2)
    print('RUNNER', room)

# 書き出さないものを消す（メモリ上だけ。.blend は保存しない）：人物・骨格・補助物・カメラ・ライト
for o in list(bpy.data.objects):
    skinned = o.type == 'MESH' and any(m.type == 'ARMATURE' for m in o.modifiers)
    if o.type in ('CAMERA', 'LIGHT', 'ARMATURE') or skinned \
            or any(c.name == 'glTF_not_exported' for c in o.users_collection):
        bpy.data.objects.remove(o)

for o in bpy.data.objects:
    if o.type != 'MESH' or any(m.name == 'decimate' for m in o.modifiers):
        continue   # Blender 5.2 ではこのスクリプトが2回実行されることがあるので、2回目は何もしない
    dec = o.modifiers.new('decimate', 'DECIMATE')
    dec.ratio = min(1.0, TARGET_FACES / max(1, len(o.data.polygons)))
    o.name = 'treadmill'
    print('MESH treadmill', len(o.data.polygons), '->', round(dec.ratio, 4))

bpy.ops.export_scene.gltf(
    filepath=os.path.join(WEB, 'yogibo.glb'), export_format='GLB', export_yup=True,
    export_apply=True, export_materials='NONE', export_cameras=False, export_lights=False,
    export_animations=False,
)
print('EXPORTED')
