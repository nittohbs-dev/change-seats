# office.blend をブラウザ用に書き出す（.blend は保存しない）
# 使い方: blender -b office.blend --python tools/export_office.py
#  - 同じ種類の家具は、軽量化した1つのメッシュを共有させる（GLBが小さくなる）
#  - 椅子の位置・向き・座面の高さを office-seats.json に書き出す
import bpy, bmesh, json, math
from mathutils import Vector

import os
# 書き出し先はこのスクリプトから見た ../web/
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "web") + os.sep
objs = [o for o in bpy.data.objects if o.type == 'MESH']

def kind(o):
    d = o.dimensions
    if o.name == '立方体': return 'wall'
    f = len(o.data.polygons)
    return {178206: 'chair', 78772: 'lounge_chair', 53710: 'table', 58926: 'side_table',
            32350: 'sofa', 179502: 'copier'}.get(f, 'other')

# ---- 座席（椅子）の情報：ワールド座標で測る（元データのローカル軸は当てにしない） ----
def world_bbox(o):
    pts = [o.matrix_world @ Vector(c) for c in o.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi

def ray_down(o, x, y, top):
    inv = o.matrix_world.inverted()
    p = inv @ Vector((x, y, top))
    d = (inv.to_3x3() @ Vector((0, 0, -1))).normalized()
    ok, loc, nor, idx = o.ray_cast(p, d)
    return (o.matrix_world @ loc).z if ok else None

def seat_info(o, facing_target, center=None, size=None):
    # center: 席の位置（x, y）を指定する（ソファのように、1つの家具に席が複数ある場合）。size: 座面を測る位置の基準の長さ
    lo, hi = world_bbox(o)
    c = Vector((center[0], center[1], 0)) if center else (lo + hi) / 2
    fwd = (facing_target.xy - c.xy).normalized()      # 椅子の正面 = 机の方向
    size = size or max(hi.x - lo.x, hi.y - lo.y)
    z = None
    for f in (0.08, 0.0, 0.15, -0.05):
        hz = ray_down(o, c.x + fwd.x * size * f, c.y + fwd.y * size * f, hi.z + 1)
        if hz is not None and hz < lo.z + (hi.z - lo.z) * 0.85:
            z = hz; break
    if z is None: z = lo.z + (hi.z - lo.z) * 0.45
    yaw = math.atan2(fwd.x, -fwd.y)                     # 正面が -Y のとき 0（右回りに増える Blender の Z 回転）
    return {'x': round(c.x, 3), 'y': round(c.y, 3), 'z': round(z, 3), 'rot': round(yaw, 4),
            'h': round(hi.z - lo.z, 3), 'floor': round(lo.z, 3)}

tables = [o for o in objs if kind(o) == 'table']
tables.sort(key=lambda t: -((world_bbox(t)[0] + world_bbox(t)[1]) / 2).x)   # 右(+x)から A, B, C
tlabel = {t.name: 'ABC'[i] for i, t in enumerate(tables)}

seats = []
side_tables = [o for o in objs if kind(o) == 'side_table']
def center(o):
    lo, hi = world_bbox(o); return (lo + hi) / 2
for o in objs:
    k = kind(o)
    if k not in ('chair', 'lounge_chair'): continue
    oc = center(o)
    if k == 'chair':
        t = min(tables, key=lambda t: (center(t).xy - oc.xy).length)
        # 長机の中心ではなく、机の長辺に向かって座る：机の長い向きに沿った成分を消す
        tlo, thi = world_bbox(t)
        tc = center(t)
        target = Vector((oc.x, tc.y, 0)) if (thi.x - tlo.x) > (thi.y - tlo.y) else Vector((tc.x, oc.y, 0))
        s = seat_info(o, target)
        s['group'] = tlabel[t.name]
    else:
        t = min(side_tables, key=lambda t: (center(t).xy - oc.xy).length)
        s = seat_info(o, center(t))
        s['group'] = 'L'
    s['type'] = k
    seats.append(s)
# ラウンジのソファに3席。ラウンジの椅子（サイドテーブルを挟んで手前）と同じ x に並べ、サイドテーブルの方を向いて座る
for sofa in [o for o in objs if kind(o) == 'sofa']:
    slo, shi = world_bbox(sofa)
    for st in sorted(side_tables, key=lambda t: center(t).x):
        sc = center(st)
        s = seat_info(sofa, sc, center=((sc.x), (slo.y + shi.y) / 2), size=3.0)
        s['group'] = 'L'
        s['type'] = 'sofa'
        seats.append(s)
order = {'A': 0, 'B': 1, 'C': 2, 'L': 3}
seats.sort(key=lambda s: (order[s['group']], -s['y'], s['x']))
for i, s in enumerate(seats, 1): s['id'] = i

with open(OUT + 'office-seats.json', 'w', encoding='utf-8') as f:
    f.write('{"seats": [\n')
    f.write(',\n'.join('  ' + json.dumps({k: s[k] for k in ('id','group','type','x','y','z','rot','h','floor')}, ensure_ascii=False) for s in seats))
    f.write('\n]}\n')
print('SEATS', len(seats))

# ---- 家具の床面の長方形（Blender の XY 座標）：2D平面図と、分身の通れない場所の計算に使う ----
items = []
for o in objs:
    lo, hi = world_bbox(o)
    items.append({'kind': kind(o), 'x0': round(lo.x, 3), 'y0': round(lo.y, 3), 'x1': round(hi.x, 3), 'y1': round(hi.y, 3)})
items.sort(key=lambda i: (i['kind'], i['x0'], i['y0']))
margin = 6
layout = {
    'bounds': {'x0': round(min(i['x0'] for i in items) - margin, 1), 'y0': round(min(i['y0'] for i in items) - margin, 1),
               'x1': round(max(i['x1'] for i in items) + margin, 1), 'y1': round(max(i['y1'] for i in items) + margin, 1)},
    'items': items,
}
with open(OUT + 'office-layout.json', 'w', encoding='utf-8') as f:
    f.write('{"bounds": ' + json.dumps(layout['bounds']) + ',\n"items": [\n')
    f.write(',\n'.join('  ' + json.dumps(i, ensure_ascii=False) for i in items))
    f.write('\n]}\n')
print('LAYOUT', len(items), layout['bounds'])

# ---- 軽量化：種類ごとに1つ減らしたメッシュを作り、全員で共有 ----
target = {'chair': 6000, 'lounge_chair': 3000, 'table': 2500, 'side_table': 2500, 'sofa': 3000, 'copier': 5000}
shared = {}
for o in objs:
    k = kind(o)
    if k in ('wall', 'other'): continue
    if k not in shared:
        m = o.data.copy()
        bm = bmesh.new(); bm.from_mesh(m)
        bm.free()
        tmp = bpy.data.objects.new('tmp_' + k, m)
        bpy.context.scene.collection.objects.link(tmp)
        mod = tmp.modifiers.new('dec', 'DECIMATE')
        mod.ratio = min(1.0, target[k] / max(1, len(m.polygons)))
        dg = bpy.context.evaluated_depsgraph_get()
        newm = bpy.data.meshes.new_from_object(tmp.evaluated_get(dg))
        newm.name = k
        bpy.data.objects.remove(tmp)
        shared[k] = newm
        print('DECIMATED', k, len(newm.polygons))
    o.data = shared[k]
for k, m in shared.items():
    for p in m.polygons: p.use_smooth = False

# 名前で種類が分かるようにする（ブラウザ側で色分けに使う）
cnt = {}
for o in objs:
    k = kind(o) if o.data.name not in shared else o.data.name
    k = o.data.name if o.data.name in shared else kind(o)
    cnt[k] = cnt.get(k, 0) + 1
    o.name = f'{k}_{cnt[k]}'

for o in list(bpy.data.objects):
    if o.type != 'MESH': bpy.data.objects.remove(o)

bpy.ops.export_scene.gltf(filepath=OUT + 'office.glb', export_format='GLB', export_yup=True,
                          export_apply=True, export_materials='NONE', export_cameras=False, export_lights=False)
print('EXPORTED')
