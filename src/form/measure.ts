/**
 * フォーム解析 v2 の計測（純粋なロジック）。
 * RepTracker が溜めたフレームから、1レップ分の RepMetrics（信頼度・撮影角度・速度・種目ごとの姿勢指標）を作る。
 * 角度は度、比は体節長に対する比。座標は縦横比補正済みの正規化座標（y は下向きが正）。
 * 閾値のうち「暫定」と書いたものは根拠が弱い仮の値。
 */
import type { FormExerciseKey, Landmark, Pose, RepMetrics, ViewKind, ViewOk } from './types'
import { LM } from './types'
import { jointAngle, signedTiltFromVertical, tiltFromVertical } from './geometry'
import { CONFIG, MIN_VISIBILITY, SIDE_INDEX, isLegKey } from './rules'
import type { Joint, Side } from './rules'

const RAD = 180 / Math.PI

/** 撮影角度（world あり）：真横からのずれ φ。15° 以下 ok、30° 以下 caution、それより大きいと ng */
const PHI_OK = 15
const PHI_CAUTION = 30
/** φ から向きを決める境界（暫定）：30° 以下は side、60° 以上は front、その間は oblique */
const PHI_SIDE = 30
const PHI_FRONT = 60
/** 撮影角度（world なし）：肩幅 ÷ 胴の長さ。0.25 未満 side、0.6 以上 front（暫定） */
const RATIO_SIDE = 0.25
const RATIO_FRONT = 0.6
/** 信頼度の角度の項 */
const ANGLE_TERM: Record<ViewOk, number> = { ok: 1, caution: 0.8, ng: 0.4 }
/** visibility の項：0.5 → 0.5、0.8 → 1.0 の線形 */
const VIS_LOW = 0.5
const VIS_HIGH = 0.8
/** 体節長が「安定」とみなす、セット内の中央値に対する比の範囲 */
const STABLE_MIN = 0.85
const STABLE_MAX = 1.15
/** スティッキングポイント：ピーク（谷）とみなす速度の変化の大きさ（ピーク速度に対する割合、暫定） */
const STICK_DROP = 0.1
/** 伸張側の範囲（暫定）：squat は膝の内角がこれ以下（屈曲 90° 以上）、bench は肘がこれ以下 */
const STRETCH_SQUAT_MAX = 90
const STRETCH_BENCH_MAX = 100
/** バー軌道を比べるときの再サンプル点の数 */
const PATH_POINTS = 21

const round = (v: number, digits: number): number => {
  const f = 10 ** digits
  return Math.round(v * f) / f
}
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y)
const mean = (xs: number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length

/** 中央値。空なら undefined（偶数個のときは中央2つの平均） */
export function median(xs: number[]): number | undefined {
  if (xs.length === 0) return undefined
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** 1フレーム分の計測用データ（RepTracker が作る） */
export interface MeasureFrame {
  t: number
  /** 必要な関節が見えていたか */
  visible: boolean
  side?: Side
  /** 縦横比補正済みの 2D 姿勢 */
  pose?: Pose
  /** worldLandmarks（メートル。あれば） */
  world?: Pose
  /** 種目の必要な関節（使っている側） */
  pts?: Partial<Record<Joint, Landmark>>
  /** 主関節の角度（中央値フィルタ後） */
  angle?: number
  /** 主な角度すべて（中央値フィルタ後） */
  angles?: Record<string, number>
  /** 必要な関節の visibility の最小値 */
  minVis?: number
  /** 体節長（2D）：squat は太もも・すね、bench/curl は上腕・前腕 */
  segA?: number
  segB?: number
  /** 脚（squat）または腕（bench/curl）の長さ（world、m） */
  worldLen?: number
}

/** 体節長（2D）。squat は太もも・すね、bench/curl は上腕・前腕 */
export function segmentLengths(key: FormExerciseKey, pts: Partial<Record<Joint, Landmark>>): { a: number; b: number } | undefined {
  if (isLegKey(key)) {
    if (!pts.hip || !pts.knee || !pts.ankle) return undefined
    return { a: dist(pts.hip, pts.knee), b: dist(pts.knee, pts.ankle) }
  }
  if (!pts.shoulder || !pts.elbow || !pts.wrist) return undefined
  return { a: dist(pts.shoulder, pts.elbow), b: dist(pts.elbow, pts.wrist) }
}

/** world（メートル）での脚（squat：股関節→膝→足首）または腕（肩→肘→手首）の長さ */
export function worldLength(key: FormExerciseKey, world: Pose, side: Side): number | undefined {
  const idx = SIDE_INDEX[side]
  const joints: Joint[] = isLegKey(key) ? ['hip', 'knee', 'ankle'] : ['shoulder', 'elbow', 'wrist']
  const p = joints.map((j) => world[idx[j]])
  if (p.some((q) => !q)) return undefined
  const d = (a: Landmark, b: Landmark) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
  return d(p[0], p[1]) + d(p[1], p[2])
}

/** フレームを作る。minVis・体節長・world の長さはここで計算する */
export function makeFrame(
  key: FormExerciseKey,
  src: {
    t: number
    side: Side
    pts: Partial<Record<Joint, Landmark>>
    pose: Pose
    world?: Pose
    angle: number
    angles: Record<string, number>
  },
): MeasureFrame {
  let minVis = 1
  for (const j of CONFIG[key].joints) minVis = Math.min(minVis, src.pts[j]?.visibility ?? 0)
  const seg = segmentLengths(key, src.pts)
  return {
    t: src.t,
    visible: true,
    side: src.side,
    pose: src.pose,
    world: src.world,
    pts: src.pts,
    angle: src.angle,
    angles: src.angles,
    minVis,
    segA: seg?.a,
    segB: seg?.b,
    worldLen: src.world ? worldLength(key, src.world, src.side) : undefined,
  }
}

// ---------------------------------------------------------------------------
// 信頼度
// ---------------------------------------------------------------------------

/** visibility の項：最小 visibility 0.5 → 0.5、0.8 以上 → 1.0 の線形 */
export function visibilityTerm(minVis: number): number {
  return clamp(0.5 + ((minVis - VIS_LOW) / (VIS_HIGH - VIS_LOW)) * 0.5, 0.5, 1)
}

/** 信頼度 = visibility の項 × 角度の項 × 体節長の項 × 欠損の項（0〜1、小数2桁） */
export function combineConfidence(visTerm: number, viewOk: ViewOk, stability: number, missingRatio: number): number {
  return round(clamp(visTerm * ANGLE_TERM[viewOk] * stability * (1 - missingRatio), 0, 1), 2)
}

/** 体節長の安定度：セット内の中央値に対する比が 0.85〜1.15 に入るフレームの割合 */
export function segmentStability(frames: MeasureFrame[], medA: number | undefined, medB: number | undefined): number {
  if (!medA || !medB) return 0
  const withSeg = frames.filter((f) => f.segA !== undefined && f.segB !== undefined)
  if (withSeg.length === 0) return 0
  const inRange = (v: number, m: number) => v / m >= STABLE_MIN && v / m <= STABLE_MAX
  const ok = withSeg.filter((f) => inRange(f.segA as number, medA) && inRange(f.segB as number, medB))
  return ok.length / withSeg.length
}

// ---------------------------------------------------------------------------
// 撮影角度
// ---------------------------------------------------------------------------

/** world の左右の肩を結ぶ線の水平面上の向きから、真横からのずれ φ（度）。真横＝肩の線がカメラの奥行き方向（z）なら 0 */
export function phiFromWorld(world: Pose): number | undefined {
  const l = world[LM.leftShoulder]
  const r = world[LM.rightShoulder]
  if (!l || !r) return undefined
  const sx = r.x - l.x
  const sz = r.z - l.z
  if (sx === 0 && sz === 0) return undefined
  return Math.atan2(Math.abs(sx), Math.abs(sz)) * RAD
}

/** key が lateral（正面撮影）のときは、真横ではなく正面（φ=90°）からのずれで判定する */
export function viewOkFromPhi(phi: number, key?: FormExerciseKey): ViewOk {
  if (key === 'lateral') phi = 90 - phi
  if (phi <= PHI_OK) return 'ok'
  if (phi <= PHI_CAUTION) return 'caution'
  return 'ng'
}

export function viewKindFromPhi(phi: number): ViewKind {
  if (phi <= PHI_SIDE) return 'side'
  if (phi >= PHI_FRONT) return 'front'
  return 'oblique'
}

/** 2D の肩幅 ÷ 胴の長さ（肩中点〜股関節中点）。測れなければ undefined */
export function shoulderRatio(pose: Pose): number | undefined {
  const ls = pose[LM.leftShoulder]
  const rs = pose[LM.rightShoulder]
  const lh = pose[LM.leftHip]
  const rh = pose[LM.rightHip]
  if (!ls || !rs || !lh || !rh) return undefined
  const sm = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 }
  const hm = { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2 }
  const torso = dist(sm, hm)
  if (torso === 0) return undefined
  return dist(ls, rs) / torso
}

export function viewFromRatio(ratio: number, key?: FormExerciseKey): { view: ViewKind; viewOk: ViewOk } {
  // lateral は正面が ok、真横が ng（暫定）
  if (key === 'lateral') {
    if (ratio >= RATIO_FRONT) return { view: 'front', viewOk: 'ok' }
    if (ratio < RATIO_SIDE) return { view: 'side', viewOk: 'ng' }
    return { view: 'oblique', viewOk: 'caution' }
  }
  // world が無いときは φ を出せないので、向きから良否を決める（暫定）：side ok、oblique caution、front ng
  if (ratio < RATIO_SIDE) return { view: 'side', viewOk: 'ok' }
  if (ratio >= RATIO_FRONT) return { view: 'front', viewOk: 'ng' }
  return { view: 'oblique', viewOk: 'caution' }
}

/** レップ内のフレームから撮影の向きと良否を決める（world があれば φ、無ければ 2D の比） */
export function judgeView(frames: MeasureFrame[], key?: FormExerciseKey): { view: ViewKind; viewOk: ViewOk; phi?: number } {
  const phis: number[] = []
  for (const f of frames) {
    const p = f.world ? phiFromWorld(f.world) : undefined
    if (p !== undefined) phis.push(p)
  }
  if (phis.length > 0) {
    const phi = median(phis) as number
    return { view: viewKindFromPhi(phi), viewOk: viewOkFromPhi(phi, key), phi: round(phi, 1) }
  }
  const ratios: number[] = []
  for (const f of frames) {
    const r = f.pose ? shoulderRatio(f.pose) : undefined
    if (r !== undefined) ratios.push(r)
  }
  if (ratios.length === 0) return { view: 'unknown', viewOk: 'caution' }
  return viewFromRatio(median(ratios) as number, key)
}

// ---------------------------------------------------------------------------
// 速度
// ---------------------------------------------------------------------------

export interface TimedY {
  t: number
  /** 追う点の y（下向きが正） */
  y: number
  /** その時点の主関節角度 */
  angle: number
}
export interface VelocityPoint {
  t: number
  /** 上向きの速度（y の単位/秒）。上がっていれば正 */
  v: number
  angle: number
}

/** y の時間微分（中央差分）。上向きを正にする。両隣があるフレームだけ */
export function upwardVelocities(s: TimedY[]): VelocityPoint[] {
  const out: VelocityPoint[] = []
  for (let i = 1; i < s.length - 1; i++) {
    const dt = (s[i + 1].t - s[i - 1].t) / 1000
    if (dt <= 0) continue
    out.push({ t: s[i].t, v: -(s[i + 1].y - s[i - 1].y) / dt, angle: s[i].angle })
  }
  return out
}

/** 区間 [t0, t1] の平均の上向き速度（始点と終点の位置から）。測れなければ undefined */
export function meanUpwardVelocity(s: TimedY[], t0: number, t1: number): number | undefined {
  const inside = s.filter((p) => p.t >= t0 && p.t <= t1)
  if (inside.length < 2) return undefined
  const a = inside[0]
  const b = inside[inside.length - 1]
  const dt = (b.t - a.t) / 1000
  if (dt <= 0) return undefined
  return -(b.y - a.y) / dt
}

/** 最初の2レップの最大速度 ref に対する低下率（%）。ref より速ければ 0 */
export function velocityLossPct(v: number, ref: number): number {
  if (!(ref > 0)) return 0
  return round(Math.max(0, (1 - v / ref) * 100), 1)
}

/**
 * スティッキングポイント：上げる動作の最初の速度ピークの後、最初の極小の時点の主関節角度。
 * ノイズを拾わないよう、ピークから 10% 下がって初めて「ピークを過ぎた」とし、
 * 極小から 10% 戻って初めて「極小」とする（10% はピーク速度に対する割合、暫定）。見つからなければ undefined。
 */
export function stickingAngle(vs: VelocityPoint[]): number | undefined {
  let peak = -Infinity
  let i = 0
  for (; i < vs.length; i++) {
    if (vs[i].v > peak) peak = vs[i].v
    else if (peak > 0 && vs[i].v <= peak * (1 - STICK_DROP)) break
  }
  if (i >= vs.length) return undefined
  let min = vs[i].v
  let minIdx = i
  for (let j = i + 1; j < vs.length; j++) {
    if (vs[j].v < min) {
      min = vs[j].v
      minIdx = j
    } else if (vs[j].v >= min + STICK_DROP * peak) {
      return vs[minIdx].angle
    }
  }
  return undefined
}

// ---------------------------------------------------------------------------
// 1レップの計測
// ---------------------------------------------------------------------------

/** セット全体で溜めた統計（RepTracker が管理） */
export interface SetStats {
  /** セット内の体節長（2D）の履歴 */
  segA: number[]
  segB: number[]
  /** world の脚・腕の長さ（m）の履歴 */
  worldLen: number[]
  /** 1〜2レップ目の平均速度（体節長/秒）。最大 2 件 */
  firstVelocities: number[]
  /** 1レップ目のバー軌道（手首の x を時間で再サンプルしたもの。bench） */
  firstPath?: number[]
}

export interface RepWindow {
  startT: number
  /** 最も曲がった時点 */
  minT: number
  endT: number
}

export interface MeasureResult {
  metrics: RepMetrics
  /** このレップの平均の上げる速度（体節長/秒）。RepTracker が 1〜2 レップ目の基準にする */
  velocityNorm?: number
  /** このレップのバー軌道（bench） */
  path?: number[]
}

/** 区間を時間で等分して、手首の x を再サンプルする（下ろす・上げるを前後半に分けて 0〜0.5・0.5〜1 に対応させる） */
function resamplePath(pts: { t: number; x: number }[], win: RepWindow): number[] | undefined {
  if (pts.length < 2) return undefined
  const at = (t: number): number => {
    if (t <= pts[0].t) return pts[0].x
    for (let i = 1; i < pts.length; i++) {
      if (t <= pts[i].t) {
        const a = pts[i - 1]
        const b = pts[i]
        const w = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t)
        return a.x + (b.x - a.x) * w
      }
    }
    return pts[pts.length - 1].x
  }
  const out: number[] = []
  for (let k = 0; k < PATH_POINTS; k++) {
    const u = k / (PATH_POINTS - 1)
    const t = u <= 0.5
      ? win.startT + (u / 0.5) * (win.minT - win.startT)
      : win.minT + ((u - 0.5) / 0.5) * (win.endT - win.minT)
    out.push(at(t))
  }
  return out
}

/** 上腕と体幹のなす角（符号つき）。前＝プラス、後ろ＝マイナス。facing は体の向き（+1 は画面の右向き） */
function signedUpperArm(frame: MeasureFrame, facing: number | undefined): number | undefined {
  const raw = frame.angles?.upperArm
  if (raw === undefined) return undefined
  if (facing === undefined) return raw
  const { shoulder, elbow, hip } = frame.pts ?? {}
  if (!shoulder || !elbow || !hip) return raw
  const dx = hip.x - shoulder.x
  const dy = hip.y - shoulder.y
  const ex = elbow.x - shoulder.x
  const ey = elbow.y - shoulder.y
  const cross = dx * ey - dy * ex
  return cross * facing < 0 ? raw : -raw
}

/** 体の向き（鼻が肩より右なら +1、左なら −1）。分からなければ undefined */
function facingOf(frames: MeasureFrame[]): number | undefined {
  const diffs: number[] = []
  for (const f of frames) {
    const nose = f.pose?.[LM.nose]
    const sh = f.pts?.shoulder
    if (nose && sh && (nose.visibility ?? 0) >= MIN_VISIBILITY) diffs.push(nose.x - sh.x)
  }
  const m = median(diffs)
  if (m === undefined || Math.abs(m) < 1e-6) return undefined
  return m > 0 ? 1 : -1
}

const range = (xs: number[]): number | undefined => (xs.length ? Math.max(...xs) - Math.min(...xs) : undefined)

/**
 * 1レップ分のフレームから RepMetrics を作る。
 * frames はレップ開始から終了まで（見えなかったフレームも含む）。lead は開始前に最も伸びていたフレーム（立位・伸びきりの基準）。
 */
export function measureRep(
  key: FormExerciseKey,
  frames: MeasureFrame[],
  win: RepWindow,
  set: SetStats,
  lead?: MeasureFrame,
): MeasureResult {
  const vis = frames.filter((f) => f.visible && f.angle !== undefined && f.pts && f.pose)
  const missing = frames.length > 0 ? 1 - vis.length / frames.length : 1
  const visTerm = vis.length > 0 ? mean(vis.map((f) => visibilityTerm(f.minVis ?? 0))) : 0
  const { view, viewOk } = judgeView(vis, key)
  const medA = median(set.segA)
  const medB = median(set.segB)
  const stability = segmentStability(vis, medA, medB)

  const metrics: RepMetrics = {
    confidence: combineConfidence(visTerm, viewOk, stability, missing),
    view,
    viewOk,
  }
  const result: MeasureResult = { metrics }
  if (vis.length < 2 || !medA || !medB) return result

  const refLen = medA + medB // 脚（squat）または腕（bench/curl）の2D の長さ
  const eccFirst = CONFIG[key].eccentricFirst

  // --- 速度 ---
  const series: TimedY[] = vis.map((f) => ({
    t: f.t,
    // 脚の種目は股関節、腕の種目は手首の上下動。pulldown は手首が下がる動きが上げる動作に当たるので符号を反転する
    y: isLegKey(key) ? (f.pts?.hip?.y as number) : key === 'pulldown' ? -(f.pts?.wrist?.y as number) : (f.pts?.wrist?.y as number),
    angle: f.angle as number,
  })).filter((s) => Number.isFinite(s.y))
  const t0 = eccFirst ? win.minT : win.startT
  const t1 = eccFirst ? win.endT : win.minT
  const meanV = meanUpwardVelocity(series, t0, t1)
  if (meanV !== undefined && meanV > 0) {
    const vNorm = meanV / refLen
    result.velocityNorm = vNorm
    // メートル換算は world があるときだけ（world は股関節が原点なので、長さのスケールだけ借りる）
    const wl = median(set.worldLen)
    if (wl) metrics.concentricVelocity = round(vNorm * wl, 2)
    // 1〜2レップ目の最大に対する低下率。3レップ目以降は最初の2レップだけを基準にする
    const ref = set.firstVelocities.length < 2 ? Math.max(vNorm, ...set.firstVelocities) : Math.max(...set.firstVelocities)
    metrics.velocityLossPct = velocityLossPct(vNorm, ref)
  }
  const inWindow = upwardVelocities(series).filter((p) => p.t >= t0 && p.t <= t1)
  const stick = stickingAngle(inWindow)
  if (stick !== undefined) metrics.stickingAngle = round(stick, 1)

  // 最も曲がったフレーム（同値なら最初）
  let bottom = vis[0]
  for (const f of vis) if ((f.angle as number) < (bottom.angle as number)) bottom = f

  if (key === 'squat') measureSquat(metrics, vis, bottom, lead, refLen)
  else if (key === 'bench') measureBench(metrics, result, vis, bottom, win, set, medB)
  else if (key === 'curl') measureCurl(metrics, vis, lead)
  else if (key === 'rdl') measureRdl(metrics, bottom)
  else if (key === 'ohp') measureOhp(metrics, vis, bottom, lead)
  else if (key === 'lateral') measureLateral(metrics, vis, bottom)
  else if (key === 'pulldown') measurePulldown(metrics, vis, lead)
  else if (key === 'ohext') measureOhext(metrics, vis, bottom)
  else measureBss(metrics, vis, bottom)

  // 主関節が伸張側の範囲にいた時間の割合（squat・bench のみ。curl は伸張域がレップの外側、新6種目は基準が未確定）
  if (key === 'squat' || key === 'bench') {
    const limit = key === 'squat' ? STRETCH_SQUAT_MAX : STRETCH_BENCH_MAX
    const span = vis[vis.length - 1].t - vis[0].t
    if (span > 0) {
      let inside = 0
      for (let i = 0; i < vis.length - 1; i++) {
        if ((vis[i].angle as number) <= limit) inside += vis[i + 1].t - vis[i].t
      }
      metrics.timeInStretch = round(inside / span, 2)
    }
  }
  return result
}

function measureSquat(
  m: RepMetrics, vis: MeasureFrame[], bottom: MeasureFrame, lead: MeasureFrame | undefined, legLen: number,
) {
  m.kneeFlexionBottom = round(180 - (bottom.angle as number), 1)
  const torso = vis.map((f) => f.angles?.torso).filter((v): v is number => v !== undefined)
  if (torso.length) m.trunkLeanMax = round(Math.max(...torso), 1)

  const { shoulder, hip, knee, ankle } = bottom.pts ?? {}
  if (knee && ankle) m.shinLeanBottom = round(tiltFromVertical(ankle, knee), 1)
  const torsoBottom = bottom.angles?.torso
  if (torsoBottom !== undefined) m.trunkLeanBottom = round(torsoBottom, 1)
  if (shoulder && hip && knee) {
    // バー≒肩の真下に荷重線があるとみなし、荷重線から股関節・膝までの水平距離の比
    const dh = Math.abs(shoulder.x - hip.x)
    const dk = Math.abs(shoulder.x - knee.x)
    if (dh + dk > 0) m.hipMomentShare = round(dh / (dh + dk), 2)
  }

  // かかとの浮き：つま先に対するかかとの上昇量（立位の基準フレームとの差）の最大 ÷ 脚の長さ
  const offset = (f: MeasureFrame): number | undefined => {
    if (!f.pose || !f.side) return undefined
    const [heelI, toeI] = f.side === 'left' ? [29, 31] : [30, 32]
    const heel = f.pose[heelI]
    const toe = f.pose[toeI]
    if (!heel || !toe || (heel.visibility ?? 0) < MIN_VISIBILITY || (toe.visibility ?? 0) < MIN_VISIBILITY) return undefined
    return toe.y - heel.y
  }
  const ref = (lead ? offset(lead) : undefined) ?? offset(vis[0])
  if (ref !== undefined && legLen > 0) {
    let max = 0
    for (const f of vis) {
      const o = offset(f)
      if (o !== undefined) max = Math.max(max, o - ref)
    }
    m.heelLift = round(max / legLen, 3)
  }

  // 正面撮影のときだけ：膝の内側への倒れ込み（股関節-膝-足首の投影角の 180° からのずれ。膝が内側なら正）
  if (m.view === 'front') {
    let best: number | undefined
    for (const f of vis) {
      const v = valgusDeg(f)
      if (v !== undefined && (best === undefined || v > best)) best = v
    }
    if (best !== undefined) m.kneeValgusDeg = round(best, 1)
  }
}

/** 正面撮影の1フレームでの膝の内側への倒れ込み（度）。内側が正 */
function valgusDeg(f: MeasureFrame): number | undefined {
  const { hip, knee, ankle } = f.pts ?? {}
  const lh = f.pose?.[LM.leftHip]
  const rh = f.pose?.[LM.rightHip]
  if (!hip || !knee || !ankle || !lh || !rh) return undefined
  const dev = 180 - jointAngle(hip, knee, ankle)
  const mid = (lh.x + rh.x) / 2
  const outward = Math.sign(hip.x - mid)
  if (outward === 0 || ankle.y === hip.y) return undefined
  // 股関節-足首の線が膝の高さを通る x に対して、膝が体の中心側にあれば内側
  const lineX = hip.x + ((ankle.x - hip.x) * (knee.y - hip.y)) / (ankle.y - hip.y)
  const inward = (knee.x - lineX) * outward < 0
  return inward ? dev : -dev
}

function measureBench(
  m: RepMetrics, result: MeasureResult, vis: MeasureFrame[], bottom: MeasureFrame, win: RepWindow, set: SetStats,
  forearm: number,
) {
  // バー軌道のずれ：1レップ目の軌道との差の最大 ÷ 前腕の長さ（1レップ目は 0）
  const wrist = vis.flatMap((f) => (f.pts?.wrist ? [{ t: f.t, x: f.pts.wrist.x }] : []))
  const path = resamplePath(wrist, win)
  if (path) {
    result.path = path
    if (!set.firstPath) m.barPathDrift = 0
    else if (forearm > 0) {
      let max = 0
      for (let i = 0; i < path.length; i++) max = Math.max(max, Math.abs(path[i] - set.firstPath[i]))
      m.barPathDrift = round(max / forearm, 3)
    }
  }

  // 腰の持ち上がり：上げる動作中の、最下点からの腰の上昇量の最大 ÷ 胴の長さ（最下点の肩〜腰）
  const hipAt = (f: MeasureFrame): Landmark | undefined => {
    if (!f.pose || !f.side) return undefined
    const h = f.pose[SIDE_INDEX[f.side].hip]
    return h && (h.visibility ?? 0) >= MIN_VISIBILITY ? h : undefined
  }
  const h0 = hipAt(bottom)
  const sh = bottom.pts?.shoulder
  if (h0 && sh) {
    const torso = dist(sh, h0)
    if (torso > 0) {
      let max = 0
      for (const f of vis) {
        if (f.t < win.minT || f.t > win.endT) continue
        const h = hipAt(f)
        if (h) max = Math.max(max, h0.y - h.y)
      }
      m.hipRise = round(max / torso, 3)
    }
  }
}

function measureCurl(m: RepMetrics, vis: MeasureFrame[], lead: MeasureFrame | undefined) {
  const facing = facingOf(vis)
  const arm = vis.map((f) => signedUpperArm(f, facing)).filter((v): v is number => v !== undefined)
  const ur = range(arm)
  if (ur !== undefined) m.upperArmRange = round(ur, 1)
  const tr = range(vis.map((f) => f.angles?.torso).filter((v): v is number => v !== undefined))
  if (tr !== undefined) m.torsoRange = round(tr, 1)

  // 最下点（伸ばしきり）＝肘が最も伸びたフレーム。レップは 130° で始まり終わるので、開始前の立位フレームも候補に入れる
  if (facing === undefined) return
  let ext = lead && lead.angle !== undefined ? lead : undefined
  for (const f of vis) if (!ext || (f.angle as number) > (ext.angle as number)) ext = f
  const s = ext ? signedUpperArm(ext, facing) : undefined
  if (s !== undefined) m.shoulderAngleAtBottom = round(s, 1)
}

// ---------------------------------------------------------------------------
// 追加6種目（しきい値は analysis.ts 側。ここは数値を出すだけ）
// ---------------------------------------------------------------------------

/** 体幹の後傾（鉛直から後ろへの角度、前傾は 0）。facing は体の向き（+1 は画面の右向き） */
function leanBack(f: MeasureFrame, facing: number): number | undefined {
  const s = f.angles?.trunkSigned
  if (s === undefined) return undefined
  return Math.max(0, -s * facing)
}

/** レップ中の体幹の後傾の最大。向きが分からなければ undefined */
function maxLeanBack(vis: MeasureFrame[], facing: number | undefined): number | undefined {
  if (facing === undefined) return undefined
  const v = vis.map((f) => leanBack(f, facing)).filter((x): x is number => x !== undefined)
  return v.length ? round(Math.max(...v), 1) : undefined
}

/** rdl：最下点の股関節屈曲と膝の内角 */
function measureRdl(m: RepMetrics, bottom: MeasureFrame) {
  m.hipFlexionBottom = round(180 - (bottom.angle as number), 1)
  const knee = bottom.angles?.knee
  if (knee !== undefined) m.kneeAngleBottom = round(knee, 1)
}

/** ohp：体幹の後傾の最大と開始時の後傾（反りの増加を見る）、最下点の肘の屈曲 */
function measureOhp(m: RepMetrics, vis: MeasureFrame[], bottom: MeasureFrame, lead: MeasureFrame | undefined) {
  m.elbowFlexionBottom = round(180 - (bottom.angle as number), 1)
  const facing = facingOf(vis)
  const max = maxLeanBack(vis, facing)
  if (max !== undefined) m.trunkLeanBack = max
  if (facing !== undefined) {
    const base = leanBack(lead ?? vis[0], facing)
    if (base !== undefined) m.trunkLeanBackBaseline = round(base, 1)
  }
}

/** lateral：肩外転の最大（左右の大きい方）、上げきった時点の左右差、体幹の振れ */
function measureLateral(m: RepMetrics, vis: MeasureFrame[], bottom: MeasureFrame) {
  const abd = vis.flatMap((f) => [f.angles?.abdL, f.angles?.abdR]).filter((v): v is number => v !== undefined)
  if (abd.length) m.abductionTop = round(Math.max(...abd), 1)
  const l = bottom.angles?.abdL
  const r = bottom.angles?.abdR
  if (l !== undefined && r !== undefined) m.abductionAsymmetry = round(Math.abs(l - r), 1)
  const tr = range(vis.map((f) => f.angles?.trunkSigned).filter((v): v is number => v !== undefined))
  if (tr !== undefined) m.torsoRange = round(tr, 1)
}

/** pulldown：体幹の後傾の最大、体幹の振れ、上で伸ばしきったときの肘の内角 */
function measurePulldown(m: RepMetrics, vis: MeasureFrame[], lead: MeasureFrame | undefined) {
  const max = maxLeanBack(vis, facingOf(vis))
  if (max !== undefined) m.trunkLeanBack = max
  const tr = range(vis.map((f) => f.angles?.trunkSigned).filter((v): v is number => v !== undefined))
  if (tr !== undefined) m.torsoRange = round(tr, 1)
  // 開始前に最も伸びていたフレームも候補に入れる（curl の最下点と同じ考え方）
  let ext = lead?.angle
  for (const f of vis) if (ext === undefined || (f.angle as number) > ext) ext = f.angle
  if (ext !== undefined) m.elbowExtensionTop = round(ext, 1)
}

/** ohext：最下点の肘の屈曲、上腕の振れ（上腕の鉛直からの角度の範囲。符号つきなので真上を通っても正しい） */
function measureOhext(m: RepMetrics, vis: MeasureFrame[], bottom: MeasureFrame) {
  m.elbowFlexionBottom = round(180 - (bottom.angle as number), 1)
  const tilts = vis.flatMap((f) => {
    const { shoulder, elbow } = f.pts ?? {}
    return shoulder && elbow ? [signedTiltFromVertical(shoulder, elbow)] : []
  })
  const ur = range(tilts)
  if (ur !== undefined) m.upperArmRange = round(ur, 1)
}

/** bss：前脚の膝の屈曲と体幹の前傾の最大（前傾は崩れにはせず、注記用） */
function measureBss(m: RepMetrics, vis: MeasureFrame[], bottom: MeasureFrame) {
  m.kneeFlexionBottom = round(180 - (bottom.angle as number), 1)
  const torso = vis.map((f) => f.angles?.torso).filter((v): v is number => v !== undefined)
  if (torso.length) m.trunkLeanMax = round(Math.max(...torso), 1)
}
