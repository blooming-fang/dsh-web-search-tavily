/**
 * TavilyTab: the feature-owned Plugins settings tab rendering the Tavily
 * provider configuration inside a disclosure card styled exactly like the
 * shipped plugin cards (settings-plugins' PluginCard): a header with the
 * provider icon, title, description, pending badge and chevron; the write-only
 * API-key secret control plus endpoint / depth / result-count fields; and the
 * discard/save footer. All styling rides the `--dsw-alias-*` tokens, so the
 * tab follows the active theme.
 */

import { useState } from 'react'
import { IconChevronDownOutline14, IconGlobeOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { FieldState, TavilyKeyState, TavilyTabState } from './service.ts'
import css from './TavilyTab.module.css'

/** Form actions the controller injects beside the hooks seat. */
export interface TavilyTabActions {
  edit: (field: string, text: string) => void
  resetField: (field: string) => void
  save: () => void
  discard: () => void
  addKey: (name: string, value: string) => Promise<boolean>
  renameKey: (id: string, name: string) => Promise<boolean>
  replaceKey: (id: string, value: string) => Promise<boolean>
  removeKey: (id: string) => Promise<boolean>
  toggleKey: (id: string, enabled: boolean) => Promise<boolean>
  refreshUsage: (id: string) => Promise<boolean>
  refreshAllUsage: () => Promise<void>
}

/** One labelled text control (mirrors settings-plugins' ValueField). */
function ValueField(props: {
  id: string
  label: string
  hint: string
  overriddenLabel: string
  resetLabel: string
  invalidLabel: string
  disabled: boolean
  numeric?: boolean
  text: string
  placeholder?: string
  overridden: boolean
  invalid: boolean
  onEdit: (text: string) => void
  onReset: () => void
}) {
  const field = props
  return (
    <div className={css.field}>
      <div className={css.head}>
        <label className={css.label} htmlFor={field.id}>
          {field.label}
        </label>
        {field.overridden ? (
          <span className={css.badges}>
            <span className={css.badge}>{field.overriddenLabel}</span>
            <button
              type="button"
              className={css.reset}
              disabled={field.disabled}
              onClick={field.onReset}
            >
              {field.resetLabel}
            </button>
          </span>
        ) : null}
      </div>
      <input
        id={field.id}
        className={field.invalid ? css.inputInvalid : css.input}
        type="text"
        {...(field.numeric === true ? { inputMode: 'numeric' as const } : {})}
        {...(field.invalid ? { 'aria-invalid': true } : {})}
        value={field.text}
        placeholder={field.placeholder ?? ''}
        disabled={field.disabled}
        onChange={(event) => {
          field.onEdit(event.target.value)
        }}
      />
      <p className={field.invalid ? css.invalid : css.hint}>
        {field.invalid ? field.invalidLabel : field.hint}
      </p>
    </div>
  )
}

/** Multi-key manager: public names in settings, write-only values in credentials. */
function KeyManager(props: {
  keys: TavilyKeyState[]
  t: (key: any) => string
} & Pick<TavilyTabActions, 'addKey' | 'renameKey' | 'replaceKey' | 'removeKey' | 'toggleKey' | 'refreshUsage' | 'refreshAllUsage'>) {
  const [name, setName] = useState('')
  const [secret, setSecret] = useState('')
  const [busy, setBusy] = useState(false)
  const add = async () => {
    setBusy(true)
    const ok = await props.addKey(name, secret)
    setBusy(false)
    if (ok) { setName(''); setSecret('') }
  }
  return (
    <div className={css.keyManager}>
      <div className={css.keyManagerHead}>
        <div>
          <h3 className={css.subheading}>{props.t('keysTitle')}</h3>
          <p className={css.hint}>{props.t('keysHint')}</p>
        </div>
        <button type="button" className={css.discard} disabled={props.keys.length === 0} onClick={() => void props.refreshAllUsage()}>
          {props.t('refreshAll')}
        </button>
      </div>
      <div className={css.addKeyRow}>
        <input className={css.input} value={name} placeholder={props.t('keyNamePlaceholder')} onChange={(event) => setName(event.target.value)} />
        <input className={css.input} type="password" autoComplete="off" value={secret} placeholder={props.t('keyValuePlaceholder')} onChange={(event) => setSecret(event.target.value)} />
        <button type="button" className={css.save} disabled={busy || name.trim() === '' || secret.trim() === ''} onClick={() => void add()}>
          {props.t(busy ? 'adding' : 'addKey')}
        </button>
      </div>
      {props.keys.length === 0 ? <p className={css.empty}>{props.t('keysEmpty')}</p> : null}
      <div className={css.keyList}>
        {props.keys.map((key) => <KeyRow key={key.id} item={key} {...props} />)}
      </div>
    </div>
  )
}

function KeyRow(props: {
  item: TavilyKeyState
  t: (key: any) => string
} & Pick<TavilyTabActions, 'renameKey' | 'replaceKey' | 'removeKey' | 'toggleKey' | 'refreshUsage'>) {
  const { item } = props
  const [name, setName] = useState(item.name)
  const [secret, setSecret] = useState('')
  const usage = item.usage
  const account = usage?.account
  const keyUsage = usage?.key
  // 用量优先取账号套餐（plan），Key 级别（limit 通常为 null）做兜底。
  const used = account?.plan_usage ?? keyUsage?.usage ?? 0
  const limit = account?.plan_limit ?? keyUsage?.limit ?? 0
  const searchUsed = account?.search_usage ?? keyUsage?.search_usage ?? 0
  const percent = limit > 0 ? Math.min(100, (used / limit) * 100) : 0
  return (
    <article className={css.keyCard}>
      <div className={css.keyTop}>
        <div className={css.keyIdentity}>
          <input className={css.nameInput} value={name} onChange={(event) => setName(event.target.value)} onBlur={() => { if (name.trim() !== item.name) void props.renameKey(item.id, name) }} />
          <code className={css.ref}>{item.ref}</code>
        </div>
        <span className={item.configured ? css.badge : css.badgeMuted}>{props.t(item.configured ? 'configured' : 'unconfigured')}</span>
        <button type="button" role="switch" aria-checked={item.enabled} className={item.enabled ? css.switchOn : css.switch} onClick={() => void props.toggleKey(item.id, !item.enabled)}>
          <span />
        </button>
      </div>
      {usage !== undefined ? (
        <div className={css.usage}>
          <div className={css.usageNumbers}>
            <strong>{used}</strong>
            <span>{limit > 0 ? `/ ${limit}` : ''} {props.t('credits')}</span>
          </div>
          <div className={css.meter}><span style={{ width: `${percent}%` }} /></div>
          <div className={css.usageMeta}>
            <span>{props.t('searchUsage')}: {searchUsed}</span>
            <span>{item.usage?.account?.current_plan ?? ''}</span>
          </div>
        </div>
      ) : <p className={css.hint}>{item.error ?? props.t('usageNotLoaded')}</p>}
      {item.error !== undefined ? <p className={css.invalid}>{item.error}</p> : null}
      <div className={css.keyActions}>
        <input className={css.compactInput} type="password" autoComplete="off" value={secret} placeholder={props.t('replacePlaceholder')} onChange={(event) => setSecret(event.target.value)} />
        <button type="button" className={css.discard} disabled={secret.trim() === '' || !item.writable} onClick={() => { void props.replaceKey(item.id, secret).then((ok) => { if (ok) setSecret('') }) }}>{props.t('replace')}</button>
        <button type="button" className={css.discard} disabled={item.loading || !item.configured} onClick={() => void props.refreshUsage(item.id)}>{props.t(item.loading ? 'loadingUsage' : 'refreshUsage')}</button>
        <button type="button" className={css.danger} disabled={!item.writable} onClick={() => { if (window.confirm(props.t('deleteConfirm'))) void props.removeKey(item.id) }}>{props.t('delete')}</button>
      </div>
    </article>
  )
}

/**
 * Render the Tavily settings tab as a disclosure card.
 * @param props - the composed props: the controller's hooks seat (`useTavilyTab`),
 * form actions, and the standard locale `t`.
 * @returns the card, or nothing while the namespace is unavailable.
 */
export function TavilyTab(props: {
  useTavilyTab: <S>(sel: (s: TavilyTabState) => S) => S
} & TavilyTabActions & PropsLocale<'settings.tavily'>) {
  const { t } = props
  const state = props.useTavilyTab((snapshot) => snapshot)
  const [open, setOpen] = useState(false)
  if (!state.available) return null
  const disabled = !state.writable
  const blocked = !state.dirty || state.invalid || state.saving
  return (
    <section className={css.section}>
      <div>
        <h2 className={css.heading}>{t('heading')}</h2>
        <p className={css.intro}>{t('intro')}</p>
      </div>
      <div className={css.card}>
      <button
        type="button"
        className={css.header}
        aria-expanded={open}
        aria-label={`${t(open ? 'collapse' : 'expand')}: ${t('name')}`}
        onClick={() => {
          setOpen(!open)
        }}
      >
        <IconGlobeOutline14 className={css.icon} />
        <span className={css.headText}>
          <span className={css.name}>{t('name')}</span>
          <span className={css.description}>{t('description')}</span>
        </span>
        {state.dirty ? (
          <span className={css.pending}>{t('unsaved')}</span>
        ) : null}
        <IconChevronDownOutline14
          className={open ? `${css.chevron} ${css.chevronOpen}` : css.chevron}
        />
      </button>
      {open ? (
        <div className={css.body}>
          {!state.writable ? (
            <p className={css.readOnly} role="status">
              {t('readOnly')}
            </p>
          ) : null}
          <ValueField
            id="tavily-config-endpoint"
            label={t('endpoint')}
            hint={t('endpointHint')}
            overriddenLabel={t('overridden')}
            resetLabel={t('reset')}
            invalidLabel={t('invalidNumber')}
            disabled={disabled}
            {...state.endpoint}
            onEdit={(text) => {
              props.edit('endpoint', text)
            }}
            onReset={() => {
              props.resetField('endpoint')
            }}
          />
          <ValueField
            id="tavily-config-search-depth"
            label={t('searchDepth')}
            hint={t('searchDepthHint')}
            overriddenLabel={t('overridden')}
            resetLabel={t('reset')}
            invalidLabel={t('invalidNumber')}
            disabled={disabled}
            {...state.searchDepth}
            onEdit={(text) => {
              props.edit('searchDepth', text)
            }}
            onReset={() => {
              props.resetField('searchDepth')
            }}
          />
          <ValueField
            id="tavily-config-max-results"
            label={t('maxResults')}
            hint={t('maxResultsHint')}
            overriddenLabel={t('overridden')}
            resetLabel={t('reset')}
            invalidLabel={t('invalidNumber')}
            numeric
            disabled={disabled}
            {...state.maxResults}
            onEdit={(text) => {
              props.edit('maxResults', text)
            }}
            onReset={() => {
              props.resetField('maxResults')
            }}
          />
          <KeyManager
            keys={state.keys}
            t={t}
            addKey={props.addKey}
            renameKey={props.renameKey}
            replaceKey={props.replaceKey}
            removeKey={props.removeKey}
            toggleKey={props.toggleKey}
            refreshUsage={props.refreshUsage}
            refreshAllUsage={props.refreshAllUsage}
          />
          <div className={css.footer}>
            {state.failed ? (
              <p className={css.failed} role="status">
                {t('saveFailed')}
              </p>
            ) : null}
            <button
              type="button"
              className={css.discard}
              disabled={!state.dirty || state.saving}
              onClick={props.discard}
            >
              {t('discard')}
            </button>
            <button
              type="button"
              className={css.save}
              disabled={blocked}
              onClick={props.save}
            >
              {t(state.saving ? 'saving' : 'save')}
            </button>
          </div>
        </div>
      ) : null}
      </div>
    </section>
  )
}

export const TavilySettingsSection = TavilyTab

export type { FieldState, TavilyTabState }
