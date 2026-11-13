# オフィスの Blender ファイルをブラウザ用に書き出す（.blend は保存しない）
# 使い方: blender -b "C:/Users/yyy20/OneDrive/ドキュメント/office_clean_conference_table_legs.blend" --python tools/export_office.py
# そのあと、GLB を圧縮する（画像を縮小して WebP に。形は meshopt で圧縮）:
#   npx -y @gltf-transform/cli@4 meshopt web/office.glb web/office.glb
#   npx -y @gltf-transform/cli@4 resize web/office.glb web/office.glb --width 1024 --height 1024
#   npx -y @gltf-transform/cli@4 webp web/office.glb web/office.glb
# ノードで作った模様（石・レンガなど）は glTF に出せないので、書き出す前に Cycles で画像に焼き付ける（ベイク）。
#
# 書き出すもの（どれも web/ に置く）
#  - office.glb          3Dモデル。重いもの（椅子など）は軽量化し、同じ種類の椅子は1つの形を共有させる
#  - office-seats.json   席（長机の椅子18脚・ラウンジ（カフェ）の椅子3脚・長いソファ3席＝24席）の位置・向き・座面の高さ
#  - office-layout.json  2D平面図と、分身が歩ける場所の計算に使う「床面の形」と、ルートの目印の場所
#
# 座標は Blender の XY（床）と Z（上）。床の高さは、床の板（平面）の上面。
import bpy, bmesh, json, math, os
from mathutils import Vector

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "web") + os.sep
CELL = 0.5            # 床面の形を取る細かさ
BODY = 10.5           # 分身がぶつかる高さ（床から。約1.9m）

# ---------------- 下ごしらえ ----------------
# 0. 編集モードのまま保存されたファイルでも動くように、オブジェクトモードにする
if bpy.context.object and bpy.context.object.mode != 'OBJECT':
    bpy.ops.object.mode_set(mode='OBJECT')
# 1. 描画しない（非表示・レンダリング対象外の）ものは消す。古い椅子・古いコピー機・形のバックアップなど
#    （コレクションの「インスタンス」で使われる共有モデルは、シーンに置かれていないだけなので残す）
instanced = {o.instance_collection for o in bpy.data.objects if o.instance_type == 'COLLECTION' and o.instance_collection}
shared_objs = {x for c in instanced for x in c.all_objects}
for o in list(bpy.data.objects):
    if o.type == 'MESH' and (o.hide_render or (o not in shared_objs and not o.visible_get())):
        bpy.data.objects.remove(o)


def join_parts(parts, name):
    """部品に分かれた家具を、1つのオブジェクトにまとめる（マテリアルはそのまま。ブラウザで描く数を減らす）"""
    parts = [p for p in parts if p.type == 'MESH']
    if not parts: return None
    bpy.ops.object.select_all(action='DESELECT')
    for p in parts: p.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    if len(parts) > 1: bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.name = name
    return obj


def roots_named(word):
    return [o for o in bpy.data.objects if o.parent is None and o.type == 'EMPTY' and word in o.name and o.children]


# 2. 部品で作った椅子・複合機・カフェの椅子を、1つずつにまとめる
for r in roots_named('オフィスチェア'): join_parts(list(r.children_recursive), 'chair_src')
for r in roots_named('複合機'): join_parts(list(r.children_recursive), 'copier_src')
for r in roots_named('カフェチェア'): join_parts(list(r.children_recursive), 'cafe_src')
# ソファのまとまりには、長いソファ（中央）と、東のブースのソファ（名前の末尾 .001〜）が入っている。
# 長いソファは1つに、ブースのソファは1脚ずつ（末尾ごと）にまとめる
for r in roots_named('ロングソファ'):
    by_suffix = {}
    for c in r.children_recursive:
        if c.type == 'MESH':
            by_suffix.setdefault(c.name.rsplit('.', 1)[1] if '.' in c.name else '', []).append(c)
    for suf, parts in by_suffix.items():
        join_parts(parts, 'sofa_src' if suf == '' else 'booth_src')
# 3. 共有モデル（コレクションのインスタンス）は、まとめてから、配置用の空のオブジェクトの数だけ実物にする（形は共有）
for c in instanced:
    linked = c.name not in bpy.context.scene.collection.children
    if linked: bpy.context.scene.collection.children.link(c)
    bpy.context.view_layer.update()
    word = 'chair_src' if any('椅子' in x.name or 'チェア' in x.name for x in c.all_objects) else c.name
    join_parts(list(c.all_objects), word)
    placers = [o for o in bpy.data.objects if o.instance_type == 'COLLECTION' and o.instance_collection == c]
    bpy.ops.object.select_all(action='DESELECT')
    for e in placers: e.select_set(True)
    bpy.context.view_layer.objects.active = placers[0]
    bpy.ops.object.duplicates_make_real(use_base_parent=True, use_hierarchy=True)
    for e in placers: e.instance_type = 'NONE'
    if linked: bpy.context.scene.collection.children.unlink(c)   # 元の共有モデル（原点にある）は書き出さない
print('PREPARED', sum(1 for o in bpy.data.objects if o.type == 'MESH' and o.name.startswith('chair_src')), 'chairs,',
      sum(1 for o in bpy.data.objects if o.type == 'MESH' and o.name.startswith('copier_src')), 'copier')

# 4. 親（空のオブジェクトなど）を外す。位置はそのまま（親を消した時に、子が動かないように）
for o in bpy.data.objects:
    if o.parent:
        mw = o.matrix_world.copy()
        o.parent = None
        o.matrix_world = mw
scene_objs = set(bpy.context.scene.objects)
objs = [o for o in bpy.data.objects if o.type == 'MESH' and o in scene_objs]


def world_bbox(o):
    pts = [o.matrix_world @ Vector(c) for c in o.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi


def center(o):
    lo, hi = world_bbox(o)
    return (lo + hi) / 2


floor_obj = next((o for o in objs if o.name.startswith('平面')), None)
FLOOR_Z = world_bbox(floor_obj)[1].z if floor_obj else min(world_bbox(o)[0].z for o in objs)


def kind(o):
    """家具の種類。2D平面図の色分け・3Dの色・席選びに使う"""
    n, f = o.name, len(o.data.polygons)
    if o is floor_obj: return 'floor'
    # 家具（mesh_node.*）は面の数で見分ける。左が office.blend2.blend、右が軽くした office_stone_brick.blend
    by_faces = {178206: 'chair', 70952: 'chair', 78772: 'lounge_chair', 30870: 'lounge_chair',
                58926: 'side_table', 20278: 'side_table', 32350: 'sofa', 12531: 'sofa',
                179502: 'copier', 69548: 'copier', 5134: 'table'}
    if f in by_faces: return by_faces[f]
    if n.startswith('chair_src'): return 'chair'        # 部品で作った椅子（下ごしらえで1つにまとめたもの）
    if n.startswith('copier_src'): return 'copier'
    if n.startswith('回転チェア'): return 'chair'         # 東の長机の椅子（office_clean_conference_table_legs.blend）
    if n.startswith('cafe_src'): return 'lounge_chair'  # カフェの椅子（ラウンジの席）
    if n.startswith('カフェテーブル'): return 'side_table'
    if n.startswith('sofa_src'): return 'sofa'
    if n.startswith('booth_src'): return 'sofa2'        # ブースのソファ（席にはしない）
    if n.startswith('メタルラック'): return 'shelf'
    if n.startswith('会議テーブル'): return 'table'      # 長机の脚
    if n.startswith('vase'): return 'plant'
    if n.startswith('Modju'): return 'sofa2'
    if n.startswith('OfficeDesk'): return 'desk'
    if n.startswith('TV'): return 'tv'
    if n.startswith('Pole') or n.startswith('Shelf'): return 'shelf'
    if n.startswith('Panel') or n.startswith('円柱'): return 'decor'
    if n.startswith('Mark') or n.startswith('NBS'): return 'sign'
    if n.startswith('立方体'):
        lo, hi = world_bbox(o)
        if hi.z - lo.z < 0.5 and lo.z > FLOOR_Z + 2 and (hi.x - lo.x) * (hi.y - lo.y) > 10:
            return 'table'          # 机の天板
        if hi.z < FLOOR_Z + 4.5 and max(hi.x - lo.x, hi.y - lo.y) < 25:
            return 'cabinet'        # 腰より低い棚・台（外壁に沿った細長い窓台は、壁として扱う）
        return 'wall'
    return 'other'


KINDS = {o.name: kind(o) for o in objs}

# ---------------- 席 ----------------
def ray_down(o, x, y, top):
    inv = o.matrix_world.inverted()
    p = inv @ Vector((x, y, top))
    d = (inv.to_3x3() @ Vector((0, 0, -1))).normalized()
    ok, loc, nor, idx = o.ray_cast(p, d)
    return (o.matrix_world @ loc).z if ok else None


def seat_info(o, facing_target, at=None, size=None):
    """席の位置・向き（rot）・座面の高さ。at で位置を指定できる（ソファのように1つの家具に席が複数ある時）"""
    lo, hi = world_bbox(o)
    c = Vector((at[0], at[1], 0)) if at else (lo + hi) / 2
    fwd = (facing_target.xy - c.xy).normalized()      # 正面 = 机（またはサイドテーブル）の方向
    size = size or max(hi.x - lo.x, hi.y - lo.y)
    z = None
    for f in (0.08, 0.0, 0.15, -0.05):
        hz = ray_down(o, c.x + fwd.x * size * f, c.y + fwd.y * size * f, hi.z + 1)
        if hz is not None and hz < lo.z + (hi.z - lo.z) * 0.85:
            z = hz
            break
    if z is None: z = lo.z + (hi.z - lo.z) * 0.45
    yaw = math.atan2(fwd.x, -fwd.y)                     # 正面が -Y のとき 0
    return {'x': round(c.x, 3), 'y': round(c.y, 3), 'z': round(z, 3), 'rot': round(yaw, 4),
            'h': round(hi.z - lo.z, 3), 'floor': round(FLOOR_Z, 3)}


tops = [o for o in objs if KINDS[o.name] == 'table' and o.name.startswith('立方体')]   # 机の天板
chairs = [o for o in objs if KINDS[o.name] == 'chair']
by_top = {t.name: [] for t in tops}
for ch in chairs:
    t = min(tops, key=lambda t: (center(t).xy - center(ch).xy).length)
    if (center(t).xy - center(ch).xy).length < 12: by_top[t.name].append(ch)
# 長机 = 椅子が6脚ある天板のうち、南（-y）の3つ。北の会議室の机は除く
long_tables = sorted([t for t in tops if len(by_top[t.name]) == 6], key=lambda t: center(t).y)[:3]
long_tables.sort(key=lambda t: -center(t).x)          # 東（+x）から A, B, C
labels = {t.name: 'ABC'[i] for i, t in enumerate(long_tables)}
print('TABLES', [(t.name, len(by_top[t.name])) for t in tops], '-> long', [t.name for t in long_tables])

seats = []
for t in long_tables:
    tlo, thi = world_bbox(t)
    tc = center(t)
    for ch in by_top[t.name]:
        oc = center(ch)
        # 机の中心ではなく、机の長い辺に向かって座る
        target = Vector((oc.x, tc.y, 0)) if (thi.x - tlo.x) > (thi.y - tlo.y) else Vector((tc.x, oc.y, 0))
        s = seat_info(ch, target)
        s.update(group=labels[t.name], type='chair')
        seats.append(s)
side_tables = sorted([o for o in objs if KINDS[o.name] == 'side_table'], key=lambda o: center(o).x)
for o in objs:
    if KINDS[o.name] != 'lounge_chair': continue
    st = min(side_tables, key=lambda t: (center(t).xy - center(o).xy).length)
    s = seat_info(o, center(st))
    s.update(group='L', type='lounge_chair')
    seats.append(s)
for sofa in [o for o in objs if KINDS[o.name] == 'sofa']:
    slo, shi = world_bbox(sofa)
    for st in side_tables:          # サイドテーブルの向かいに1席ずつ
        sc = center(st)
        s = seat_info(sofa, sc, at=(sc.x, (slo.y + shi.y) / 2), size=3.0)
        s.update(group='L', type='sofa')
        seats.append(s)
order = {'A': 0, 'B': 1, 'C': 2, 'L': 3}
seats.sort(key=lambda s: (order[s['group']], -s['y'], s['x']))
for i, s in enumerate(seats, 1): s['id'] = i
with open(OUT + 'office-seats.json', 'w', encoding='utf-8') as f:
    f.write('{"seats": [\n')
    f.write(',\n'.join('  ' + json.dumps({k: s[k] for k in ('id', 'group', 'type', 'x', 'y', 'z', 'rot', 'h', 'floor')}, ensure_ascii=False) for s in seats))
    f.write('\n]}\n')
print('SEATS', len(seats), {g: sum(1 for s in seats if s['group'] == g) for g in 'ABCL'})

# ---------------- 床面の形（2D平面図・歩ける場所） ----------------
# 壁はドアの開口部も含めた1つの形なので、外枠の長方形では部屋がふさがる。
# 床から BODY の高さまでにかかる面を、真上から見た形で、CELL ごとの升目に写し取る。
solid = [o for o in objs if KINDS[o.name] != 'floor']
lo_all = Vector((min(world_bbox(o)[0].x for o in solid), min(world_bbox(o)[0].y for o in solid), 0))
hi_all = Vector((max(world_bbox(o)[1].x for o in solid), max(world_bbox(o)[1].y for o in solid), 0))
BX0, BY0 = math.floor(lo_all.x) - 2, math.floor(lo_all.y) - 2
BX1, BY1 = math.ceil(hi_all.x) + 2, math.ceil(hi_all.y) + 2
NX, NY = int((BX1 - BX0) / CELL), int((BY1 - BY0) / CELL)
PRIORITY = ['wall', 'decor', 'sign', 'tv', 'shelf', 'cabinet', 'plant', 'desk', 'sofa2', 'copier', 'table', 'side_table', 'sofa', 'lounge_chair', 'chair', 'other']
grid = [[None] * NX for _ in range(NY)]


def mark(i, j, k):
    if 0 <= i < NX and 0 <= j < NY:
        cur = grid[j][i]
        if cur is None or PRIORITY.index(k) > PRIORITY.index(cur): grid[j][i] = k


def cell_of(x, y): return int((x - BX0) / CELL), int((y - BY0) / CELL)


def mark_segment(a, b, k):
    n = max(1, int(((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2) ** 0.5 / (CELL / 3)))
    for t in range(n + 1):
        x = a[0] + (b[0] - a[0]) * t / n; y = a[1] + (b[1] - a[1]) * t / n
        mark(*cell_of(x, y), k)


def mark_polygon(pts, k):
    for a, b in zip(pts, pts[1:] + pts[:1]): mark_segment(a, b, k)
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    i0, j0 = cell_of(min(xs), min(ys)); i1, j1 = cell_of(max(xs), max(ys))
    for j in range(max(0, j0), min(NY, j1 + 1)):
        cy = BY0 + (j + 0.5) * CELL
        for i in range(max(0, i0), min(NX, i1 + 1)):
            cx = BX0 + (i + 0.5) * CELL
            inside = False
            for (x1, y1), (x2, y2) in zip(pts, pts[1:] + pts[:1]):
                if (y1 > cy) != (y2 > cy) and cx < (x2 - x1) * (cy - y1) / (y2 - y1) + x1: inside = not inside
            if inside: mark(i, j, k)


z_lo, z_hi = FLOOR_Z + 0.1, FLOOR_Z + BODY
for o in solid:
    k = KINDS[o.name]
    lo, hi = world_bbox(o)
    if hi.z < z_lo or lo.z > z_hi: continue           # ぶつからない高さ（床下・天井近く）
    if len(o.data.polygons) > 2000:
        # 細かい家具（椅子など）は、外枠の長方形で十分
        i0, j0 = cell_of(lo.x, lo.y); i1, j1 = cell_of(hi.x, hi.y)
        for j in range(j0, j1 + 1):
            for i in range(i0, i1 + 1): mark(i, j, k)
        continue
    mw = o.matrix_world
    for p in o.data.polygons:
        vs = [mw @ o.data.vertices[v].co for v in p.vertices]
        if max(v.z for v in vs) < z_lo or min(v.z for v in vs) > z_hi: continue
        mark_polygon([(v.x, v.y) for v in vs], k)

# 升目を、同じ種類の長方形にまとめる（横に続く升目 → 縦に同じ幅で続けばまとめる）
items, open_runs = [], {}
for j in range(NY + 1):
    runs = []
    if j < NY:
        i = 0
        while i < NX:
            k = grid[j][i]
            if k is None: i += 1; continue
            s = i
            while i < NX and grid[j][i] == k: i += 1
            runs.append((k, s, i - 1))
    nxt = {}
    for r in runs:
        if r in open_runs: nxt[r] = open_runs.pop(r)
        else: nxt[r] = j
    for (k, s, e), j0 in open_runs.items():
        items.append({'kind': k, 'x0': round(BX0 + s * CELL, 2), 'y0': round(BY0 + j0 * CELL, 2),
                      'x1': round(BX0 + (e + 1) * CELL, 2), 'y1': round(BY0 + j * CELL, 2)})
    open_runs = nxt


def rect(o_list, pad=0):
    los = [world_bbox(o)[0] for o in o_list]; his = [world_bbox(o)[1] for o in o_list]
    return [round(min(v.x for v in los) - pad, 2), round(min(v.y for v in los) - pad, 2),
            round(max(v.x for v in his) + pad, 2), round(max(v.y for v in his) + pad, 2)]


def named(prefix): return [o for o in objs if o.name.startswith(prefix)]


# ルートの目印（家具のまとまりの外枠）。分身の行き先は、この近くの歩ける場所に自動で合わせる
conference = [t for t in tops if t not in long_tables and len(by_top[t.name]) >= 4]
anchors = {
    'copier': rect([o for o in objs if KINDS[o.name] == 'copier']),
    'sofa': rect([o for o in objs if KINDS[o.name] == 'sofa']),
    'lounge': rect([o for o in objs if KINDS[o.name] in ('lounge_chair', 'side_table', 'sofa')]),
    'modju': rect(named('Modju')),
    'tv': rect(named('TV_Panel')[:1]),
    'shelf': rect((named('Pole_2') or named('メタルラック'))[:1] + named('Shelf')),
    'sign': rect(named('NBS') + named('Mark')),
    'partition': rect([o for o in objs if o.name == '立方体']),
}
for i, d in enumerate(sorted(named('OfficeDesk'), key=lambda o: -center(o).y), 1):
    anchors['desk%d' % i] = rect([d])
if conference: anchors['conference'] = rect([conference[0]] + by_top[conference[0].name])
tables = [{'label': labels[t.name], 'top': rect([t]), 'area': rect([t] + by_top[t.name])} for t in long_tables]
layout = {'bounds': {'x0': BX0, 'y0': BY0, 'x1': BX1, 'y1': BY1}, 'cell': CELL, 'floorZ': round(FLOOR_Z, 3),
          'anchors': anchors, 'tables': tables, 'items': items}
with open(OUT + 'office-layout.json', 'w', encoding='utf-8') as f:
    f.write('{\n')
    for key in ('bounds', 'cell', 'floorZ', 'anchors', 'tables'):
        f.write('"%s": %s,\n' % (key, json.dumps(layout[key], ensure_ascii=False)))
    f.write('"items": [\n' + ',\n'.join('  ' + json.dumps(i, ensure_ascii=False) for i in items) + '\n]}\n')
print('LAYOUT', len(items), 'rects', layout['bounds'], {k: sum(1 for i in items if i['kind'] == k) for k in PRIORITY})

# ---------------- 3Dモデル（軽量化して GLB に） ----------------
SHARED = {'chair': 6000, 'lounge_chair': 3000, 'side_table': 2500}     # 同じ形を共有させる種類と、目標の面の数
SINGLE_MAX = 6000                                                        # それ以外で重いものは、1つずつこの面の数に減らす


def decimated(o, target):
    m = o.data.copy()
    tmp = bpy.data.objects.new('tmp_dec', m)
    bpy.context.scene.collection.objects.link(tmp)
    mod = tmp.modifiers.new('dec', 'DECIMATE')
    mod.ratio = min(1.0, target / max(1, len(m.polygons)))
    dg = bpy.context.evaluated_depsgraph_get()
    newm = bpy.data.meshes.new_from_object(tmp.evaluated_get(dg))
    for mat in m.materials: newm.materials.append(mat)
    bpy.data.objects.remove(tmp)
    return newm


def box_mesh(o):
    """細かすぎる飾り（壁のパネル）は、同じ大きさ・同じ色の箱にする"""
    lo, hi = world_bbox(o)
    inv = o.matrix_world.inverted()
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    c = (lo + hi) / 2
    d = Vector((max(hi.x - lo.x, 0.05), max(hi.y - lo.y, 0.05), max(hi.z - lo.z, 0.05)))
    for v in bm.verts: v.co = inv @ Vector((c.x + v.co.x * d.x, c.y + v.co.y * d.y, c.z + v.co.z * d.z))
    m = bpy.data.meshes.new(o.name + '_box')
    bm.to_mesh(m); bm.free()
    for mat in o.data.materials: m.materials.append(mat)
    return m


BAKE_PX = 2048        # 焼き付ける画像の横幅（縦は UV の縦横比に合わせる）


def procedural(m):
    """色（Base Color）が画像ではなく、ノードの計算（模様）でできているマテリアルか"""
    if not m or not m.node_tree: return False
    bsdf = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if not bsdf or not bsdf.inputs['Base Color'].is_linked: return False
    return bsdf.inputs['Base Color'].links[0].from_node.type != 'TEX_IMAGE'


def bake_procedural(o, slot):
    """o のうち、slot 番目のマテリアルの面を別のオブジェクトに分け、模様の色を画像に焼き付けて、画像のマテリアルに置き換える"""
    m = o.data.materials[slot]
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    if len([s for s in o.data.materials if s]) > 1:
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='DESELECT')
        o.active_material_index = slot
        bpy.ops.object.material_slot_select()
        bpy.ops.mesh.separate(type='SELECTED')
        bpy.ops.object.mode_set(mode='OBJECT')
        part = next(x for x in bpy.context.selected_objects if x is not o)
    else:
        part = o
    me = part.data
    # 模様が使っている UV（UV Map ノードの指定。無ければ描画用の UV）の範囲を 0〜1 に縮めた、焼き付け先の UV を作る
    uvnode = next((n for n in m.node_tree.nodes if n.type == 'UVMAP' and n.uv_map), None)
    src = (me.uv_layers.get(uvnode.uv_map) if uvnode else None) or next((u for u in me.uv_layers if u.active_render), me.uv_layers[0])
    us = [d.uv.copy() for d in src.data]
    u0, v0 = min(u.x for u in us), min(u.y for u in us)
    du, dv = max(1e-6, max(u.x for u in us) - u0), max(1e-6, max(u.y for u in us) - v0)
    dst = me.uv_layers.new(name='bake')
    for d, u in zip(dst.data, us): d.uv = ((u.x - u0) / du, (u.y - v0) / dv)
    me.uv_layers.active = dst                                   # Cycles は「選択中の UV」に焼き付ける
    w = BAKE_PX
    h = max(256, min(BAKE_PX, int(BAKE_PX * dv / du)))
    img = bpy.data.images.new('baked_' + m.name.split('|')[0].strip().replace(' ', '_'), w, h)
    tex = m.node_tree.nodes.new('ShaderNodeTexImage')
    tex.image = img
    m.node_tree.nodes.active = tex
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = 1
    sc.render.bake.use_pass_direct = False
    sc.render.bake.use_pass_indirect = False
    sc.render.bake.margin = 4
    bpy.ops.object.select_all(action='DESELECT')
    part.select_set(True)
    bpy.context.view_layer.objects.active = part
    bpy.ops.object.bake(type='DIFFUSE', pass_filter={'COLOR'}, use_clear=True)
    img.pack()
    # 焼き付けた画像だけの、簡単なマテリアルにする（UV は焼き付け先だけを残す）
    for u in [u for u in me.uv_layers if u.name != 'bake']: me.uv_layers.remove(u)
    nm = bpy.data.materials.new(m.name + '_baked')
    nm.use_nodes = True
    bsdf = next(n for n in nm.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')   # ノードの名前は言語設定で変わるので、種類で探す
    t = nm.node_tree.nodes.new('ShaderNodeTexImage')
    t.image = img
    nm.node_tree.links.new(t.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.9
    me.materials.clear()
    me.materials.append(nm)
    print('BAKED', m.name, '->', part.name, '%dx%d' % (w, h))
    return part


for o in list(objs):
    for i, m in enumerate(list(o.data.materials)):
        if procedural(m) and any(p.material_index == i for p in o.data.polygons):   # その色の面が無ければ飛ばす
            part = bake_procedural(o, i)
            if part is not o:
                objs.append(part)
                KINDS[part.name] = KINDS[o.name]

shared = {}
for o in objs:
    k = KINDS[o.name]
    if o.name.startswith('Panel'):
        o.data = box_mesh(o)
    elif k in SHARED and len(o.data.polygons) > SHARED[k] * 2 and not o.name.startswith(('chair_src', 'cafe_src')):   # 部品で作った椅子は、1脚ずつ置き方が違うので形を共有させない
        if k not in shared:
            shared[k] = decimated(o, SHARED[k]); shared[k].name = k
            print('DECIMATED shared', k, len(shared[k].polygons))
        o.data = shared[k]
    elif len(o.data.polygons) > SINGLE_MAX * 2 and not o.name.startswith(('chair_src', 'copier_src')):   # 部品で作った椅子・複合機は、形を共有したまま減らさない
        before = len(o.data.polygons)
        o.data = decimated(o, SINGLE_MAX if k == 'copier' else 3000)
        print('DECIMATED', o.name, before, '->', len(o.data.polygons))

# 名前で種類が分かるようにする（ブラウザ側の色分けに使う）。自分のマテリアル（色）を持つものは mat_ を付けて、色を塗り替えない
cnt = {}
for o in objs:
    k = KINDS[o.name]
    cnt[k] = cnt.get(k, 0) + 1
    has_mat = any(m is not None for m in o.data.materials)
    # 床は floor（色を持つ時は mat_floor）。画面側が床の高さを知るため、番号は付けない
    o.name = ('mat_' if has_mat else '') + (k if k == 'floor' else '%s_%d' % (k, cnt[k]))
for o in list(bpy.data.objects):
    if o.type != 'MESH': bpy.data.objects.remove(o)

bpy.ops.export_scene.gltf(filepath=OUT + 'office.glb', export_format='GLB', export_yup=True,
                          export_apply=True, export_materials='EXPORT', export_cameras=False, export_lights=False)
print('EXPORTED', os.path.getsize(OUT + 'office.glb'), 'bytes')
