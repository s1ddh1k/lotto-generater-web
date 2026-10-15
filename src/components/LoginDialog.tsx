import { useEffect, useRef, useState } from 'react'

type GoogleIdClient = {
  initialize: (options: { client_id: string; callback: (response: { credential?: string }) => void }) => void
  renderButton: (element: HTMLElement, options: Record<string, unknown>) => void
  disableAutoSelect: () => void
}

declare global {
  interface Window {
    google?: { accounts?: { id?: GoogleIdClient } }
  }
}

type LoginDialogProps = {
  clientId: string
  message: string
  onSignIn: (credential: string) => void
  onClose: () => void
}

export default function LoginDialog({ clientId, message, onSignIn, onClose }: LoginDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const buttonRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const dialog = dialogRef.current
    dialog?.showModal()
    return () => {
      dialog?.close()
      if (opener?.isConnected) opener.focus({ preventScroll: true })
    }
  }, [])

  useEffect(() => {
    let active = true
    setStatus('loading')
    setError('')

    if (!clientId) {
      setStatus('error')
      setError('현재 로그인을 사용할 수 없어요. 잠시 후 다시 시도해 주세요.')
      return
    }

    const initialize = () => {
      if (!active) return
      const googleId = window.google?.accounts?.id
      const button = buttonRef.current
      if (!googleId || !button) {
        fail()
        return
      }
      window.clearTimeout(timeout)
      try {
        googleId.initialize({
          client_id: clientId,
          callback: response => {
            if (!active) return
            if (response.credential) onSignIn(response.credential)
            else {
              setStatus('error')
              setError('로그인을 완료하지 못했어요. 다시 시도해 주세요.')
            }
          },
        })
        button.replaceChildren()
        googleId.renderButton(button, {
          type: 'standard', theme: 'outline', size: 'large', shape: 'rectangular',
          text: 'continue_with', locale: 'ko',
          width: Math.max(200, Math.min(button.parentElement?.clientWidth || 240, 320)),
        })
        setStatus('ready')
      } catch {
        fail()
      }
    }

    const fail = () => {
      if (!active) return
      window.clearTimeout(timeout)
      setStatus('error')
      setError('Google 로그인을 불러오지 못했어요. 연결을 확인하고 다시 시도해 주세요.')
      const script = document.getElementById('google-gsi-script')
      if (script) script.dataset.failed = 'true'
    }

    const timeout = window.setTimeout(fail, 15_000)
    if (window.google?.accounts?.id) {
      initialize()
      return () => { active = false; window.clearTimeout(timeout) }
    }

    let script = document.getElementById('google-gsi-script') as HTMLScriptElement | null
    if (script?.dataset.failed === 'true') {
      script.remove()
      script = null
    }
    const isNew = !script
    if (!script) {
      script = document.createElement('script')
      script.id = 'google-gsi-script'
      script.src = 'https://accounts.google.com/gsi/client'
      script.async = true
      script.defer = true
    }
    const gsiScript = script
    gsiScript.addEventListener('load', initialize)
    gsiScript.addEventListener('error', fail)
    if (isNew) document.head.appendChild(gsiScript)

    return () => {
      active = false
      window.clearTimeout(timeout)
      gsiScript.removeEventListener('load', initialize)
      gsiScript.removeEventListener('error', fail)
    }
  }, [clientId, onSignIn, attempt])

  return (
    <dialog
      ref={dialogRef}
      className="login-dialog"
      aria-labelledby="login-title"
      aria-describedby="login-description"
      onCancel={event => { event.preventDefault(); onClose() }}
      onClick={event => {
        if (event.target !== event.currentTarget) return
        const rect = event.currentTarget.getBoundingClientRect()
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose()
      }}
    >
      <button className="dialog-close" type="button" aria-label="로그인 창 닫기" onClick={onClose} autoFocus>
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
      </button>
      <span className="login-symbol" aria-hidden="true">6/45<span>.</span></span>
      <h2 id="login-title">로그인하고 시작하세요</h2>
      <p id="login-description">Google 계정으로 번호를 뽑고<br />간편하게 구매하세요.</p>
      {message ? <p className="auth-message" role="alert">{message}</p> : null}
      <div className="google-signin-area" aria-busy={status === 'loading'}>
        <div ref={buttonRef} className="google-signin-button" hidden={status !== 'ready'} />
        {status === 'loading' ? <p className="login-loading" role="status"><span className="spinner" aria-hidden="true" />로그인 연결 중</p> : null}
        {status === 'error' ? (
          <div className="login-error"><p role="alert">{error}</p><button className="retry-button" type="button" onClick={() => setAttempt(value => value + 1)}>다시 시도</button></div>
        ) : null}
      </div>
      <p className="login-note">계정 정보는 화면에 표시하지 않아요.</p>
    </dialog>
  )
}
