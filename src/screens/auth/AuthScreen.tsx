import { motion } from 'framer-motion'
import { useState, type FormEvent } from 'react'
import { apiErrorText } from '../../api/api'
import { useLogin, useRegister } from '../../api/queries'
import { Pill } from '../../components/ui'
import styles from './Auth.module.css'

type Mode = 'login' | 'register'

/** Экран входа: аккаунт нужен всем данным сервера. Логин — латиница, для @упоминаний. */
export function AuthScreen() {
  const login = useLogin()
  const register = useRegister()

  const [mode, setMode] = useState<Mode>('login')
  const [username, setUsername] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')

  const pending = login.isPending || register.isPending
  const error = login.error ?? register.error
  const ready = Boolean(username.trim()) && Boolean(password)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!ready || pending) return
    if (mode === 'login') {
      login.mutate({ username: username.trim(), password })
    } else {
      register.mutate({ username: username.trim(), name: name.trim() || undefined, password })
    }
  }

  const switchMode = (m: Mode) => {
    setMode(m)
    login.reset()
    register.reset()
  }

  return (
    <div className={styles.root}>
      <motion.div
        className={styles.card}
        initial={{ opacity: 0, y: 24, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 26 }}
      >
        <span className={styles.logo} aria-hidden="true">
          ◐
        </span>
        <h1 className={`display ${styles.title}`}>Календарь</h1>
        <p className={styles.sub}>
          {mode === 'login' ? 'Войдите, чтобы продолжить' : 'Аккаунт для задач и совместной работы'}
        </p>

        <div className={styles.mode} role="tablist" aria-label="Вход или регистрация">
          {(['login', 'register'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              className={`${styles.modeBtn} ${mode === m ? styles.modeOn : ''}`}
              onClick={() => switchMode(m)}
            >
              {m === 'login' ? 'Вход' : 'Регистрация'}
            </button>
          ))}
        </div>

        <form className={styles.form} onSubmit={submit}>
          <input
            className={styles.input}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Логин"
            aria-label="Логин"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={24}
          />
          {mode === 'register' && (
            <input
              className={styles.input}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Имя"
              aria-label="Имя"
              autoComplete="name"
              maxLength={60}
            />
          )}
          <input
            className={styles.input}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Пароль"
            aria-label="Пароль"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            maxLength={64}
          />
          {error && (
            <p className={styles.error} role="alert">
              {apiErrorText(error)}
            </p>
          )}
          <Pill tone="dark" type="submit" className={styles.submit} disabled={!ready || pending}>
            {pending ? 'Секунду…' : mode === 'login' ? 'Войти' : 'Создать аккаунт'}
          </Pill>
        </form>
      </motion.div>
    </div>
  )
}
