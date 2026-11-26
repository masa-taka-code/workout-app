import { useState } from 'react'
import type { ReactNode } from 'react'
import type { Exercise, Muscle } from '../types'
import type { EmphasisTarget, FaultFinding, FormExerciseKey, FormReport, PersonalBaseline, RepResult, StandingSnapshot } from '../form/types'
import { baselineAdvice, buildBaseline } from '../form/baseline'
import BodyMap from './BodyMap'
import {
  BASELINE_TOO_FEW_TEXT, CAUSE_LABEL, SAFETY_FAULT_CODES, barWidth, baselineButtonText, baselineConfirmText, conditionWord, confidenceDots, groupFaults,
  badPlacementReps, isReferenceRep, levelIndex, onlyLowConfidence, pctText, repsText, shareText,
} from './reportFormat'
import './FormReportView.css'

/** 自分の基準を作るのに必要な、セットの文脈 */
export interface BaselineSource {
  key: FormExerciseKey
  /** このセットの重量（kg、分からなければ 0） */
  weight: number
  /** 開始前の立位（ライブ撮影のとき） */
  standing?: StandingSnapshot
  /** 今の基準（あれば。更新をすすめる理由の判定に使う） */
  current?: PersonalBaseline
  /** 今日の日付（YYYY-MM-DD） */
  today: string
}

export interface FormReportViewProps {
  ex: Exercise
  reps: RepResult[]
  report: FormReport
  targets: EmphasisTarget[]
  targetId?: string
  onTargetChange?: (id: string) => void
  readOnly?: boolean
  onApply?: (repsCount: number, mode: 'next' | 'close') => void
  onRetake?: () => void
  baselineSource?: BaselineSource
  /** 条件の良いレップの中央値から作った基準を保存する */
  onSaveBaseline?: (baseline: PersonalBaseline) => void
}

const MAX_COUNT = 99

function Dots({ c }: { c: 'high' | 'mid' | 'low' }) {
  const { dots, word } = confidenceDots(c)
  return (
    <span className="frv-dots">
      <span aria-hidden="true" className="frv-dots-mark">{dots}</span> {word}
    </span>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <details className="card frv-section">
      <summary className="frv-summary">
        <span className="frv-summary-title">{title}</span>
        {hint && <span className="frv-summary-hint">{hint}</span>}
      </summary>
      <div className="frv-body">{children}</div>
    </details>
  )
}

function FaultCard({ f }: { f: FaultFinding }) {
  const lowOnly = onlyLowConfidence(f)
  const [first, ...others] = f.causes
  const safety = SAFETY_FAULT_CODES.includes(f.code)
  return (
    <div className="frv-fault">
      <div className="frv-fault-head">
        <span className="frv-fault-label">{f.label}</span>
        <span className="muted small">{repsText(f.reps)}</span>
        {safety && <span className="badge badge-warn">安全のため優先</span>}
      </div>
      <p className="frv-cue">{f.cue}</p>
      {lowOnly ? (
        <p className="muted">原因はまだ絞れません。セルフチェックで確かめましょう。</p>
      ) : (
        first && (
          <div className="frv-cause">
            <p>
              <span className="muted">考えられる原因：</span>
              <strong>{CAUSE_LABEL[first.cause] ?? first.cause}</strong> <Dots c={first.confidence} />
            </p>
            <p className="muted">{first.reason}</p>
            {others.length > 0 && (
              <details className="frv-sub">
                <summary className="frv-sub-summary">ほかの候補（{others.length}）</summary>
                <ul className="frv-list">
                  {others.map((c, i) => (
                    <li key={i}>
                      {CAUSE_LABEL[c.cause] ?? c.cause} <Dots c={c.confidence} />
                      <span className="muted"> {c.reason}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )
      )}
      {f.drills.length > 0 && (
        <div>
          <p className="frv-label">練習</p>
          <ul className="frv-list">
            {f.drills.slice(0, 2).map((d, i) => <li key={i}>{d}</li>)}
          </ul>
        </div>
      )}
      {f.selfCheck && (
        <details className="frv-sub" open={lowOnly}>
          <summary className="frv-sub-summary">セルフチェック</summary>
          <p className="frv-selfcheck">{f.selfCheck}</p>
        </details>
      )}
      {(f.muscleHint || f.evidence) && (
        <p className="frv-fine">
          {f.muscleHint && <>関係しうる筋肉：{f.muscleHint}</>}
          {f.muscleHint && f.evidence && ' ／ '}
          {f.evidence && <>出典：{f.evidence}</>}
        </p>
      )}
    </div>
  )
}

function Meter({ label, value }: { label: string; value: number }) {
  return (
    <div className="frv-meter-row">
      <div className="frv-meter-text">
        <span>{label}</span>
        <strong>{pctText(value)}</strong>
      </div>
      <div className="frv-meter" aria-hidden="true">
        <span style={{ width: `${barWidth(value)}%` }} />
      </div>
    </div>
  )
}

export default function FormReportView({
  ex, reps, report, targets, targetId, onTargetChange, readOnly = false,
  onApply, onRetake, baselineSource, onSaveBaseline,
}: FormReportViewProps) {
  const analyzed = reps.length
  const badPlacement = badPlacementReps(reps)
  const [count, setCount] = useState(analyzed)
  const [pain, setPain] = useState(false)

  const { improved, main, others } = groupFaults(report.faults)
  const faultCount = main.length + others.length
  const selectedTarget = targetId ?? report.emphasis.target?.id
  const tgt = report.emphasis.target
  const dist = report.emphasis.distribution
  const maxShare = Math.max(0, ...dist.map(d => d.share ?? 0))
  const highlights: Partial<Record<Muscle, number>> = {}
  for (const d of dist) {
    const v = d.share !== undefined && maxShare > 0 ? d.share / maxShare : 0.7
    for (const m of d.muscles) highlights[m] = Math.max(highlights[m] ?? 0, v)
  }
  // 基準は、このセットの条件の良いレップ（信頼度・向き・撮影条件が良いもの）の中央値で作る。採点から外したレップは使わない
  const built = !readOnly && onSaveBaseline && baselineSource
    ? buildBaseline(baselineSource.key, reps, { weight: baselineSource.weight, standing: baselineSource.standing, date: baselineSource.today })
    : undefined
  const advice = built && baselineSource?.current
    ? baselineAdvice(baselineSource.current, baselineSource.today, baselineSource.weight)
    : undefined
  const cue = report.primaryCue ?? 'この調子で'

  const level = report.emphasis.level
  const levelPos = levelIndex(level)
  // 段階（level）があるときは、約◯% は出さず段階の名前で示す
  const showShare = level === undefined
  const emphasisHint = tgt
    ? `狙い：${tgt.label}${showShare && tgt.share !== undefined ? ` ${shareText(tgt.share)}` : ''}`
    : undefined

  const saveBaseline = () => {
    if (!built || !('baseline' in built) || !onSaveBaseline) return
    const b = built.baseline
    if (!window.confirm(baselineConfirmText({ ...b, belowGeneral: [] }))) return
    // 基準に使ったレップが一般の目安でも崩れていたときは、もう一度確かめる
    if (b.belowGeneral.length > 0 && !window.confirm(baselineConfirmText(b))) return
    onSaveBaseline(b)
  }

  return (
    <div className={`frv${readOnly ? '' : ' frv-has-bar'}`}>
      <div className="frv-first card">
        <div className="frv-top">
          <h2 className="card-title">セットの結果</h2>
          <span className="badge frv-estimate">推定</span>
          <span className="muted small frv-ex">{ex.name}</span>
        </div>

        <div className="frv-count-row">
          {!readOnly && (
            <button
              type="button"
              className="btn frv-step"
              aria-label="回数を1減らす"
              disabled={count <= 0}
              onClick={() => setCount(c => Math.max(0, c - 1))}
            >−</button>
          )}
          <div className="frv-count" aria-live="polite">
            <span className="frv-count-num">{count}</span>
            <span className="frv-count-unit">回</span>
          </div>
          {!readOnly && (
            <button
              type="button"
              className="btn frv-step"
              aria-label="回数を1増やす"
              disabled={count >= MAX_COUNT}
              onClick={() => setCount(c => Math.min(MAX_COUNT, c + 1))}
            >＋</button>
          )}
        </div>
        {count !== analyzed && (
          <p className="muted small frv-fixed">回数だけ直しました（解析：{analyzed}回）。点数は変わりません。</p>
        )}

        {pain ? (
          <div className="frv-pain-band" role="alert">
            <p className="frv-pain-text">中止して医師・理学療法士に相談してください</p>
            <button type="button" className="btn" onClick={() => setPain(false)}>痛みの表示を取り消す</button>
          </div>
        ) : (
          <p className="frv-next">
            <span className="frv-next-label">次のセットで：</span>
            {report.primaryCue ? cue : 'この調子で'}
          </p>
        )}

        {report.retakeReason ? (
          <div className="frv-retake">{report.retakeReason}</div>
        ) : (
          <p className="frv-score-line">
            <strong>フォーム {Math.round(report.overallScore)}点</strong>
            <span className="muted">・撮影条件：{conditionWord(report.confidence)}</span>
          </p>
        )}

        {badPlacement.length > 0 && (
          <p className="muted small">撮影条件が悪かった回：{repsText(badPlacement)}（減点・崩れの判定から外しています）</p>
        )}
        {report.baselineNote && <p className="muted small">{report.baselineNote}</p>}
        {report.notes?.map(n => <p key={n} className="muted small">{n}</p>)}

        {!readOnly && !pain && (
          <button type="button" className="btn frv-pain-btn" onClick={() => setPain(true)}>
            痛み・しびれがあった
          </button>
        )}
      </div>

      {!pain && (
        <Section title={`崩れと原因（${faultCount}件）`}>
          {improved.length > 0 && (
            <p className="frv-good">
              改善した崩れ：{improved.map(f => f.label).join('、')}（今回は出ませんでした）
            </p>
          )}
          {faultCount === 0 && <p className="muted">目立つ崩れはありませんでした。</p>}
          {main.map(f => <FaultCard key={f.code} f={f} />)}
          {others.length > 0 && (
            <div className="frv-others">
              <p className="frv-label">その他（1レップだけ）</p>
              {others.map(f => (
                <details key={f.code} className="frv-sub">
                  <summary className="frv-sub-summary">{f.label}（{repsText(f.reps)}）</summary>
                  <FaultCard f={f} />
                </details>
              ))}
            </div>
          )}
        </Section>
      )}

      <Section title="効いている部位" hint={emphasisHint}>
        {onTargetChange && targets.length > 0 && (
          <div className="frv-chips" role="radiogroup" aria-label="効かせたい部位">
            {targets.map(t => {
              const on = t.id === selectedTarget
              return (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  className={`btn frv-chip${on ? ' frv-chip-on' : ''}`}
                  onClick={() => onTargetChange(t.id)}
                >{on ? '✓ ' : ''}{t.label}</button>
              )
            })}
          </div>
        )}
        <BodyMap
          highlights={highlights}
          size="md"
          label={`効いている部位：${level ?? dist.map(d => d.label + (d.share !== undefined ? ' ' + shareText(d.share) : '')).join('、')}`}
        />
        {level !== undefined && (
          <div className="frv-level">
            <p className="frv-level-big">{level}</p>
            {levelPos >= 0 && (
              <>
                <div className="frv-level-scale" aria-hidden="true">
                  {[0, 1, 2, 3].map(i => <span key={i} className={i === levelPos ? 'frv-level-on' : undefined} />)}
                </div>
                <div className="frv-level-ends muted small" aria-hidden="true"><span>膝</span><span>股関節</span></div>
              </>
            )}
          </div>
        )}
        {showShare && tgt?.share !== undefined && (
          <div className="frv-band" aria-hidden="true">
            <span className="frv-band-on" style={{ width: `${barWidth(tgt.share)}%` }} />
            <span className="frv-band-off" />
          </div>
        )}
        <ul className="frv-list frv-dist">
          {dist.map((d, i) => (
            <li key={i}>
              {d.label}
              {!showShare ? null : d.share !== undefined ? <strong> {shareText(d.share)}</strong> : <span className="muted">（向きだけ）</span>}
            </li>
          ))}
        </ul>
        {tgt?.score !== undefined && (
          <p className="frv-score-big">
            狙いへの効き具合 <strong>{Math.round(tgt.score)}</strong>
            <span className="muted small">（推定）</span>
          </p>
        )}
        {tgt && tgt.tips.length > 0 && (
          <div>
            <p className="frv-label">コツ</p>
            <ul className="frv-list">{tgt.tips.map((t, i) => <li key={i}>{t}</li>)}</ul>
          </div>
        )}
        <p className="muted">{report.emphasis.note}</p>
      </Section>

      <Section title="ストレッチ" hint={report.stretch ? `${Math.round(report.stretch.score)}点` : undefined}>
        {report.stretch ? (
          <>
            <Meter label="深さ（届いた割合）" value={report.stretch.reach} />
            <Meter label="深さがそろった回の割合" value={report.stretch.consistency} />
            {report.stretch.timeInStretch !== undefined && (
              <Meter label="伸びた位置にいた時間" value={report.stretch.timeInStretch} />
            )}
            <p className="muted small">比べた基準：{report.stretch.reference}</p>
          </>
        ) : (
          <p className="muted">基準動画を撮ると判定できます。</p>
        )}
      </Section>

      <Section title="レップ表" hint={`${analyzed}回`}>
        <div className="frv-table-wrap" tabIndex={0} role="region" aria-label="レップごとの結果（横にスクロールできます）">
          <table className="frv-table">
            <thead>
              <tr>
                <th scope="col">回</th>
                <th scope="col">点</th>
                <th scope="col">深さ</th>
                <th scope="col">下ろす</th>
                <th scope="col">速度低下</th>
                <th scope="col">粘り所</th>
              </tr>
            </thead>
            <tbody>
              {reps.map(r => {
                const ref = isReferenceRep(r)
                const m = r.metrics
                return (
                  <tr key={r.index} className={ref ? 'frv-ref' : undefined}>
                    <th scope="row">{r.index}{ref && <span className="frv-ref-tag">参考</span>}</th>
                    <td>{r.metrics?.placementOk === false ? '—' : Math.round(r.score)}</td>
                    <td>{Math.round(r.minAngle)}°</td>
                    <td>{r.eccentricSec.toFixed(1)}秒</td>
                    <td>{m?.velocityLossPct !== undefined ? `${Math.round(m.velocityLossPct)}%` : '—'}</td>
                    <td>{m?.stickingAngle !== undefined ? `${Math.round(m.stickingAngle)}°` : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="muted small">深さ：最も曲がった時の主関節の角度。粘り所：上げる途中でいちばん遅くなった角度。参考：撮影が不安定で目安にとどめる回。</p>
      </Section>

      {report.trend && (
        <Section title="前回との比較">
          <p>{report.trend}</p>
        </Section>
      )}

      {built && (
        <>
          <button
            type="button"
            className="btn frv-baseline"
            disabled={!('baseline' in built)}
            onClick={saveBaseline}
          >
            {'baseline' in built ? baselineButtonText(built.baseline.repCount) : 'このセットを基準にする'}
          </button>
          {!('baseline' in built) && <p className="muted small">{BASELINE_TOO_FEW_TEXT}</p>}
          {advice && <p className="muted small">{advice}</p>}
        </>
      )}

      <p className="frv-fine frv-disclaimer">{report.disclaimer}</p>

      {!readOnly && (
        <div className="frv-bar">
          <div className="frv-bar-pair">
            <button type="button" className="btn frv-bar-btn" onClick={() => onApply?.(count, 'close')}>
              反映して閉じる
            </button>
            <button type="button" className="btn frv-bar-btn" onClick={() => onRetake?.()}>
              反映せずに撮り直す
            </button>
          </div>
          <button type="button" className="btn btn-primary frv-bar-main" onClick={() => onApply?.(count, 'next')}>
            記録に反映して次のセットへ
          </button>
        </div>
      )}
    </div>
  )
}
