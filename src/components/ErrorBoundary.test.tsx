import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import ErrorBoundary, { ErrorFallback } from './ErrorBoundary'
import { backupFileName, downloadRawBackup, readRawData } from './errorBackup'

afterEach(() => vi.unstubAllGlobals())

describe('エラー表示', () => {
  it('説明と2つのボタンが出る', () => {
    const html = renderToStaticMarkup(<ErrorFallback onReset={() => {}} />)
    expect(html).toContain('画面の表示中に問題が起きました')
    expect(html).toContain('バックアップを書き出す')
    expect(html).toContain('記録画面に戻る')
  })
  it('エラーが起きていなければ子をそのまま表示する', () => {
    expect(renderToStaticMarkup(<ErrorBoundary onReset={() => {}}><p>中身</p></ErrorBoundary>)).toContain('中身')
  })
  it('getDerivedStateFromError は failed を立てる', () => {
    expect(ErrorBoundary.getDerivedStateFromError()).toEqual({ failed: true })
  })
})

describe('バックアップ', () => {
  it('ファイル名', () => {
    expect(backupFileName('2026-11-26')).toBe('workout-log-backup-2026-11-26.json')
  })
  it('localStorage の生の文字列を読む。例外・未保存は undefined', () => {
    vi.stubGlobal('localStorage', { getItem: () => '{"broken"' })
    expect(readRawData()).toBe('{"broken"')
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('denied') } })
    expect(readRawData()).toBeUndefined()
    vi.stubGlobal('localStorage', { getItem: () => null })
    expect(readRawData()).toBeUndefined()
  })
  it('読めなければダウンロードせず false', () => {
    vi.stubGlobal('localStorage', { getItem: () => null })
    expect(downloadRawBackup()).toBe(false)
  })
})
