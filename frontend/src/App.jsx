import { Fragment, useEffect, useState } from 'react'

const STATUS_TEXT = { pending: '待处理', running: '领取中', done: '已出结论' }

export default function App() {
  const [username, setUsername] = useState('printer')
  const [password, setPassword] = useState('print123456')
  const [token, setToken] = useState(localStorage.getItem('print_token') || '')
  const [role, setRole] = useState(localStorage.getItem('print_role') || '')
  const [page, setPage] = useState('review')
  const [rows, setRows] = useState([])
  const [logs, setLogs] = useState([])
  const [sheet, setSheet] = useState('插页-02')
  const [cyan, setCyan] = useState('0.08')
  const [magenta, setMagenta] = useState('0.02')
  const [selectedId, setSelectedId] = useState(null)
  const [newCyan, setNewCyan] = useState('')
  const [newMagenta, setNewMagenta] = useState('')
  const [openLogId, setOpenLogId] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function api(path, options = {}) {
    const res = await fetch(path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.detail || '请求失败')
    return data
  }

  async function loadJobs() {
    setRows(await api('/api/jobs'))
  }

  async function loadLogs() {
    setLogs(await api('/api/requeue-logs'))
  }

  useEffect(() => {
    if (!token) return
    loadJobs()
    const timer = setInterval(loadJobs, 1000)
    return () => clearInterval(timer)
  }, [token])

  useEffect(() => {
    if (!token || page !== 'requeue') return
    loadLogs()
    const timer = setInterval(loadLogs, 1000)
    return () => clearInterval(timer)
  }, [token, page])

  async function enter() {
    const data = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    })
    localStorage.setItem('print_token', data.access_token)
    localStorage.setItem('print_role', data.role)
    setToken(data.access_token)
    setRole(data.role)
  }

  async function send() {
    setError('')
    try {
      await api('/api/jobs', {
        method: 'POST',
        body: JSON.stringify({
          sheet,
          cyan_mm: Number(cyan),
          magenta_mm: Number(magenta),
        }),
      })
    } catch (err) {
      setError(err.message)
    }
  }

  function pickPending(row) {
    if (row.status !== 'pending') return
    setSelectedId(row.id)
    setNewCyan(String(row.cyan_mm))
    setNewMagenta(String(row.magenta_mm))
    setNotice('')
    setError('')
  }

  async function confirmRequeue() {
    setError('')
    setNotice('')
    const c = Number(newCyan)
    const m = Number(newMagenta)
    if (!Number.isFinite(c) || !Number.isFinite(m)) {
      setError('青品偏差必须是数字')
      return
    }
    try {
      await api(`/api/jobs/${selectedId}/deviations`, {
        method: 'PATCH',
        body: JSON.stringify({ cyan_mm: c, magenta_mm: m }),
      })
      setNotice('已改偏差并重新排队')
      await Promise.all([loadJobs(), loadLogs()])
    } catch (err) {
      setError(err.message)
    }
  }

  function leave() {
    localStorage.clear()
    setToken('')
    setRole('')
  }

  if (!token) {
    return (
      <main>
        <h1>印刷套准复核台</h1>
        <p>提交后接口只入队。另一进程领走偏差并写结论，页面轮询到结论出现。</p>
        <input value={username} onChange={(e) => setUsername(e.target.value)} />
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <button onClick={enter}>登录</button>
        <p>printer / print123456 可送复核；checker / check123456 只看</p>
      </main>
    )
  }

  const selected = rows.find((row) => row.id === selectedId) || null
  const pendingRows = rows.filter((row) => row.status === 'pending')

  return (
    <main>
      <nav>
        <strong>印刷套准复核台</strong>{' '}
        <button onClick={() => setPage('review')} disabled={page === 'review'}>
          复核台
        </button>
        <button onClick={() => setPage('requeue')} disabled={page === 'requeue'}>
          重投台
        </button>{' '}
        <span>{role === 'writer' ? '印刷员' : '只读账号'}</span>{' '}
        <button onClick={leave}>退出</button>
      </nav>

      {page === 'review' && (
        <section>
          <h2>复核台</h2>
          {role === 'writer' && (
            <p>
              <input value={sheet} onChange={(e) => setSheet(e.target.value)} />
              <input value={cyan} onChange={(e) => setCyan(e.target.value)} />
              <input value={magenta} onChange={(e) => setMagenta(e.target.value)} />
              <button onClick={send}>送复核</button>
            </p>
          )}
          {error && <p>{error}</p>}
          <table>
            <thead>
              <tr><th>印张</th><th>青</th><th>品</th><th>状态</th><th>结论</th></tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.sheet}</td>
                  <td>{row.cyan_mm}</td>
                  <td>{row.magenta_mm}</td>
                  <td>{STATUS_TEXT[row.status] || row.status}</td>
                  <td>{row.verdict || '等待'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {page === 'requeue' && (
        <section>
          <h2>重投台</h2>

          <h3>待处理列表</h3>
          {pendingRows.length === 0 && <p>暂无待处理印张</p>}
          <table>
            <thead>
              <tr><th>印张</th><th>青</th><th>品</th><th>状态</th><th>重投次数</th><th></th></tr>
            </thead>
            <tbody>
              {pendingRows.map((row) => (
                <tr key={row.id}>
                  <td>{row.sheet}</td>
                  <td>{row.cyan_mm}</td>
                  <td>{row.magenta_mm}</td>
                  <td>{STATUS_TEXT[row.status]}</td>
                  <td>{logs.filter((log) => log.job_id === row.id).length}</td>
                  <td>
                    {role === 'writer' && (
                      <button onClick={() => pickPending(row)} disabled={selectedId === row.id}>
                        改偏差
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {role !== 'writer' && <p>只读账号只能查看，不能改偏差。</p>}

          <h3>改偏差区</h3>
          {role !== 'writer' ? (
            <p>只读账号无权改偏差。</p>
          ) : !selected ? (
            <p>请在上方待处理列表选一行。</p>
          ) : selected.status !== 'pending' ? (
            <p>
              {selected.sheet} 当前为{STATUS_TEXT[selected.status] || selected.status}
              ，不可改偏差。
            </p>
          ) : (
            <div>
              <p>印张：{selected.sheet}（当前青 {selected.cyan_mm} / 品 {selected.magenta_mm}）</p>
              <label>
                青偏差(mm){' '}
                <input value={newCyan} onChange={(e) => setNewCyan(e.target.value)} />
              </label>{' '}
              <label>
                品偏差(mm){' '}
                <input value={newMagenta} onChange={(e) => setNewMagenta(e.target.value)} />
              </label>{' '}
              <button onClick={confirmRequeue}>确认重投</button>
              {error && <p>{error}</p>}
              {notice && <p>{notice}</p>}
            </div>
          )}

          <h3>重投履历</h3>
          {logs.length === 0 && <p>暂无重投履历</p>}
          <table>
            <thead>
              <tr><th>印张</th><th>改前青</th><th>改前品</th><th>改后青</th><th>改后品</th><th>改动人</th><th>时间</th><th></th></tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <Fragment key={log.id}>
                  <tr>
                    <td>{log.sheet}</td>
                    <td>{log.old_cyan_mm}</td>
                    <td>{log.old_magenta_mm}</td>
                    <td>{log.new_cyan_mm}</td>
                    <td>{log.new_magenta_mm}</td>
                    <td>{log.changed_by}</td>
                    <td>{new Date(log.changed_at).toLocaleString('zh-CN')}</td>
                    <td>
                      <button onClick={() => setOpenLogId(openLogId === log.id ? null : log.id)}>
                        履历详情
                      </button>
                    </td>
                  </tr>
                  {openLogId === log.id && (
                    <tr>
                      <td colSpan={8}>
                        <dl>
                          <dt>印张</dt><dd>{log.sheet}（#{log.job_id}）</dd>
                          <dt>改前偏差</dt><dd>青 {log.old_cyan_mm} mm / 品 {log.old_magenta_mm} mm</dd>
                          <dt>改后偏差</dt><dd>青 {log.new_cyan_mm} mm / 品 {log.new_magenta_mm} mm</dd>
                          <dt>改动人</dt><dd>{log.changed_by}</dd>
                          <dt>改动时间</dt><dd>{new Date(log.changed_at).toLocaleString('zh-CN')}</dd>
                        </dl>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </main>
  )
}
