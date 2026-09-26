import { useEffect, useState } from 'react'

function TopBar({ tab, setTab, onLeave }) {
  return (
    <nav style={{ display: 'flex', gap: 12, alignItems: 'center', borderBottom: '1px solid #999', paddingBottom: 6 }}>
      <button
        onClick={() => setTab('review')}
        disabled={tab === 'review'}
        style={{ fontWeight: tab === 'review' ? 'bold' : 'normal' }}
      >
        复核台
      </button>
      <button
        onClick={() => setTab('requeue')}
        disabled={tab === 'requeue'}
        style={{ fontWeight: tab === 'requeue' ? 'bold' : 'normal' }}
      >
        重投台
      </button>
      <button onClick={onLeave} style={{ marginLeft: 'auto' }}>退出</button>
    </nav>
  )
}

function ReviewDesk({ api, role, rows, sheet, setSheet, cyan, setCyan, magenta, setMagenta }) {
  const [error, setError] = useState('')

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

  return (
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
              <td>{row.status}</td>
              <td>{row.verdict || '等待'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function RequeueDesk({ api, role, rows, reloadTick }) {
  const pending = rows.filter((row) => row.status === 'pending')
  const [selectedId, setSelectedId] = useState(null)
  const [cyan, setCyan] = useState('')
  const [magenta, setMagenta] = useState('')
  const [logs, setLogs] = useState([])
  const [message, setMessage] = useState('')

  const selected = rows.find((row) => row.id === selectedId) || null

  // 选中待处理行时，把输入框初始化为该行当前偏差
  useEffect(() => {
    if (selected && selected.status === 'pending') {
      setCyan(String(selected.cyan_mm))
      setMagenta(String(selected.magenta_mm))
      setMessage('')
    } else if (selected) {
      setMessage('该记录已领取或已出结论，不可改偏差')
    } else {
      setMessage('')
    }
  }, [selectedId]) // eslint-disable-line react-hooks/exhaustive-deps

  // 拉重投履历；选中行被 worker 领走后仍可查看
  useEffect(() => {
    if (selectedId == null) {
      setLogs([])
      return
    }
    let alive = true
    async function loadLogs() {
      try {
        const data = await api(`/api/jobs/${selectedId}/requeue-logs`)
        if (alive) setLogs(data)
      } catch {
        if (alive) setLogs([])
      }
    }
    loadLogs()
    const timer = setInterval(loadLogs, 1000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [selectedId, reloadTick]) // eslint-disable-line react-hooks/exhaustive-deps

  // 列表刷新后若选中行已不在待处理中，保留选中（履历可看），输入区锁死
  useEffect(() => {
    if (selected && selected.status !== 'pending') {
      setMessage('该记录已领取或已出结论，不可改偏差')
    }
  }, [reloadTick]) // eslint-disable-line react-hooks/exhaustive-deps

  async function confirmRequeue() {
    if (selectedId == null) return
    setMessage('')
    try {
      await api(`/api/jobs/${selectedId}/deviation`, {
        method: 'PATCH',
        body: JSON.stringify({ cyan_mm: Number(cyan), magenta_mm: Number(magenta) }),
      })
      setMessage('已改偏差并重新排队，状态仍为待处理')
    } catch (err) {
      setMessage(err.message)
    }
  }

  const readOnly = role !== 'writer'
  const editable = selected && selected.status === 'pending' && !readOnly

  return (
    <section>
      <h2>重投台</h2>
      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div>
          <h3>待处理列表</h3>
          {pending.length === 0 && <p>暂无待处理记录</p>}
          <table border={1}>
            <thead>
              <tr><th>ID</th><th>印张</th><th>青</th><th>品</th><th>状态</th></tr>
            </thead>
            <tbody>
              {pending.map((row) => (
                <tr
                  key={row.id}
                  onClick={() => setSelectedId(row.id)}
                  style={{ cursor: 'pointer', background: row.id === selectedId ? '#ffe9a8' : undefined }}
                >
                  <td>{row.id}</td>
                  <td>{row.sheet}</td>
                  <td>{row.cyan_mm}</td>
                  <td>{row.magenta_mm}</td>
                  <td>待处理</td>
                </tr>
              ))}
            </tbody>
          </table>
          {readOnly && <p>只读账号：可查看重投履历，不能改偏差。</p>}
        </div>

        <div>
          <h3>改偏差区</h3>
          {!selected ? (
            <p>先在左侧待处理列表选择一行</p>
          ) : (
            <div>
              <p>
                {selected.sheet}（ID {selected.id}）
                {selected.status !== 'pending' && ' · 当前状态：' + selected.status}
              </p>
              <p>
                <label>
                  青偏差(mm)：
                  <input
                    value={cyan}
                    disabled={!editable}
                    onChange={(e) => setCyan(e.target.value)}
                  />
                </label>
              </p>
              <p>
                <label>
                  品偏差(mm)：
                  <input
                    value={magenta}
                    disabled={!editable}
                    onChange={(e) => setMagenta(e.target.value)}
                  />
                </label>
              </p>
              <button onClick={confirmRequeue} disabled={!editable}>
                确认重投
              </button>
              {message && <p>{message}</p>}
            </div>
          )}
        </div>

        <div>
          <h3>重投履历</h3>
          {selectedId == null ? (
            <p>选中记录后查看履历</p>
          ) : logs.length === 0 ? (
            <p>该记录暂无改偏差重投记录</p>
          ) : (
            <table border={1}>
              <thead>
                <tr>
                  <th>时间</th><th>操作人</th>
                  <th>青 改前</th><th>青 改后</th>
                  <th>品 改前</th><th>品 改后</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id}>
                    <td>{new Date(log.changed_at).toLocaleString()}</td>
                    <td>{log.changed_by}</td>
                    <td>{log.cyan_before}</td>
                    <td>{log.cyan_after}</td>
                    <td>{log.magenta_before}</td>
                    <td>{log.magenta_after}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </section>
  )
}

export default function App() {
  const [username, setUsername] = useState('printer')
  const [password, setPassword] = useState('print123456')
  const [token, setToken] = useState(localStorage.getItem('print_token') || '')
  const [role, setRole] = useState(localStorage.getItem('print_role') || '')
  const [rows, setRows] = useState([])
  const [tab, setTab] = useState('review')
  const [reloadTick, setReloadTick] = useState(0)
  const [sheet, setSheet] = useState('插页-02')
  const [cyan, setCyan] = useState('0.08')
  const [magenta, setMagenta] = useState('0.02')

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

  async function load() {
    setRows(await api('/api/jobs'))
    setReloadTick((n) => n + 1)
  }

  useEffect(() => {
    if (!token) return
    load()
    const timer = setInterval(load, 1000)
    return () => clearInterval(timer)
  }, [token])

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
        <p>printer / print123456 可送复核、可改偏差重投；checker / check123456 只看</p>
      </main>
    )
  }

  return (
    <main>
      <h1>印刷套准复核台</h1>
      <TopBar tab={tab} setTab={setTab} onLeave={leave} />
      {tab === 'review' ? (
        <ReviewDesk
          api={api}
          role={role}
          rows={rows}
          sheet={sheet}
          setSheet={setSheet}
          cyan={cyan}
          setCyan={setCyan}
          magenta={magenta}
          setMagenta={setMagenta}
        />
      ) : (
        <RequeueDesk api={api} role={role} rows={rows} reloadTick={reloadTick} />
      )}
    </main>
  )
}
