import React from 'react';
import {AbsoluteFill, Easing, interpolate, useCurrentFrame} from 'remotion';

const W = 1920;
const smooth = Easing.bezier(0.22, 1, 0.36, 1);
const clamp = {extrapolateLeft: 'clamp' as const, extrapolateRight: 'clamp' as const};

const Progress: React.FC<{frame: number}> = ({frame}) => {
  const labels = ['CLIENT CALL', 'FAST M C P', 'LOCAL LOOKUP', 'RESULT'];
  const active = frame < 120 ? 0 : frame < 255 ? 1 : frame < 470 ? 2 : 3;
  return <div className="progress-rail">
    {labels.map((label, i) => <div className={`progress-item ${active === i ? 'is-active' : ''}`} key={label}>
      <span className="progress-dot">{String(i + 1).padStart(2, '0')}</span><span>{label}</span>
    </div>)}
  </div>;
};

const Chrome: React.FC<{name: string; badge?: string}> = ({name, badge = 'KYROX / LOCAL DEMO'}) => <div className="chrome">
  <div className="traffic"><i/><i/><i/></div>
  <div className="chrome-title"><span className="tiny-mark">K</span>{name}</div>
  <div className="chrome-badge">{badge}</div>
</div>;

const CodeLine: React.FC<{n: number; children?: React.ReactNode; hot?: boolean}> = ({n, children, hot}) =>
  <div className={`code-line ${hot ? 'hot-line' : ''}`}><span className="ln">{n}</span><span>{children}</span></div>;

const ClientScene: React.FC<{frame: number; returning?: boolean}> = ({frame, returning}) => {
  const reveal = interpolate(frame, [495, 520, 570], [0, 0.35, 1], clamp);
  return <div className="scene client-scene">
    <div className="scene-top"><div><div className="eyebrow">KYROX · TOOL TRACE</div><h1>Inside one<br/><em>MCP tool call</em></h1></div><div className="scene-meta"><span className="status-dot"/>LOCAL STDIO SESSION<br/><small>ONE REQUEST · ONE RECORD</small></div></div>
    <div className="client-window">
      <Chrome name="AI client" badge="CONNECTED · KYROX"/>
      <div className="client-body">
        <div className="client-sidebar"><div className="sidebar-label">TOOLS</div><div className="tool-selected"><span className="tool-glyph">ƒ</span><span>get_stock_info</span></div><div className="muted-tool">hello_kyrox</div><div className="sidebar-foot"><span className="status-dot"/> KYROX · stdio</div></div>
        <div className="client-main">
          <div className="chat-label">TOOL INVOCATION <span>01 / 01</span></div>
          <div className="call-card"><div className="call-heading"><span className="call-icon">↗</span><div><b>get_stock_info</b><small>tool call · input</small></div><span className="call-state">{returning ? 'COMPLETE' : 'RUNNING'}</span></div>
            <div className="arg-row"><span>ticker</span><div className="value-chip">"tAAPL"</div></div>
          </div>
          <div className="assistant-note"><span className="note-dot"/><span>{returning ? 'Tool result received and serialized for the client.' : 'Looking up the local demo record…'}</span></div>
          <div className="result-card" style={{opacity: reveal, transform: `translateY(${(1-reveal)*12}px)`}}>
            <div className="result-head"><span><i className="green-dot"/> TOOL RESULT</span><span>JSON · 4 FIELDS</span></div>
            <pre>{`{\n  "ticker": "tAAPL",\n  "stock": "Test Apple",\n  "reference_value": 230.0,\n  "token_address": ""\n}`}</pre>
            <div className="result-note">Returned dictionary · local fixture data</div>
          </div>
        </div>
      </div>
    </div>
    <div className="client-caption">{returning ? 'FastMCP serializes the tool result back to the client.' : 'The client asks for one ticker. The server handles the lookup.'}</div>
  </div>;
};

const ServerScene: React.FC<{frame: number}> = ({frame}) => {
  const hit = frame > 160 && frame < 250;
  return <div className="scene server-scene">
    <div className="scene-top compact-top"><div><div className="eyebrow">01 — REGISTERED TOOL</div><h2>FastMCP routes the call<br/><em>to the function in server.py</em></h2></div><div className="scene-meta"><span className="step-number">01</span><br/>ENTRY POINT</div></div>
    <div className="editor-window server-editor">
      <Chrome name="kyro-mcp / server.py" badge="PYTHON · SOURCE"/>
      <div className="editor-body">
        <aside className="file-tree"><div className="tree-label">EXPLORER</div><div className="tree-row active">▣ &nbsp;server.py</div><div className="tree-row">▸ &nbsp;tools</div><div className="tree-row indent">stocks.py</div><div className="tree-row">▸ &nbsp;data</div><div className="tree-row indent">stocks.json</div></aside>
        <div className="code-pane">
          <div className="code-tabs"><span className="tab-active">server.py</span><span>stocks.py</span></div>
          <div className="code-content">
            <CodeLine n={1}><span className="kw">from</span> mcp.server.fastmcp <span className="kw">import</span> FastMCP</CodeLine>
            <CodeLine n={2}><span className="kw">from</span> tools.stocks <span className="kw">import</span> find_stock</CodeLine>
            <CodeLine n={3}></CodeLine>
            <CodeLine n={4}>mcp = FastMCP(<span className="str">"KYROX"</span>)</CodeLine>
            <CodeLine n={5}></CodeLine>
            <CodeLine n={6} hot={hit}><span className="decor">@mcp.tool()</span></CodeLine>
            <CodeLine n={7} hot={hit}><span className="kw">def</span> <span className="fn">get_stock_info</span>(ticker: str) -&gt; dict[str, Any]:</CodeLine>
            <CodeLine n={8}>    <span className="kw">if</span> <span className="kw">not</span> isinstance(ticker, str) <span className="kw">or not</span> ticker.strip():</CodeLine>
            <CodeLine n={9}>        <span className="kw">return</span> {'{'}<span className="str">"error"</span>: <span className="str">"Ticker must not be empty."</span>{'}'}</CodeLine>
            <CodeLine n={10}></CodeLine>
            <CodeLine n={11}>    normalized_ticker = ticker.strip()</CodeLine>
            <CodeLine n={12} hot={hit}>    stock = <span className="fn">find_stock</span>(normalized_ticker)</CodeLine>
            <CodeLine n={13}>    <span className="kw">if</span> stock <span className="kw">is</span> <span className="const">None</span>:</CodeLine>
            <CodeLine n={14}>        <span className="kw">return</span> {'{'}<span className="str">"error"</span>: ...{'}'}</CodeLine>
            <CodeLine n={15} hot={hit}>    <span className="kw">return</span> stock</CodeLine>
          </div>
        </div>
        <div className="editor-inspector"><div className="inspector-label">CALL ARGUMENT</div><div className="argument-focus">ticker<br/><b>"tAAPL"</b></div><div className="inspector-label">NEXT</div><div className="next-function">find_stock<span>(ticker)</span></div><div className="tiny-arrow">↓</div></div>
      </div>
    </div>
    <div className="scene-footnote"><span className="path-tag">server.py</span> The decorated function is exposed as an MCP tool; it passes the trimmed ticker to <b>find_stock</b>.</div>
  </div>;
};

const DataScene: React.FC<{frame: number}> = ({frame}) => {
  const validate = frame >= 290 && frame < 355;
  const lookup = frame >= 355 && frame < 430;
  const match = frame >= 430;
  return <div className="scene data-scene">
    <div className="scene-top compact-top"><div><div className="eyebrow">02 — LOCAL DATA LOOKUP</div><h2>Load, validate,<br/><em>match without case</em></h2></div><div className="scene-meta"><span className="status-dot"/>READ-ONLY<br/><small>data/stocks.json</small></div></div>
    <div className="data-grid">
      <div className="editor-window lookup-editor">
        <Chrome name="tools / stocks.py" badge="PYTHON · SOURCE"/>
        <div className="code-content lookup-code">
          {validate ? <>
            <div className="subheading"><span className="file-tag">LOAD + VALIDATE</span> load_stocks()</div>
            <CodeLine n={1}><span className="kw">def</span> <span className="fn">load_stocks</span>(file_path=None):</CodeLine>
            <CodeLine n={2}>    target_path = Path(file_path) <span className="kw">if</span> file_path <span className="kw">is not</span> <span className="const">None</span> <span className="kw">else</span> STOCKS_FILE</CodeLine>
            <CodeLine n={3}>    <span className="kw">if not</span> target_path.is_file():</CodeLine>
            <CodeLine n={4}>        <span className="kw">raise</span> FileNotFoundError(...)</CodeLine>
            <CodeLine n={5}>    <span className="kw">try</span>:</CodeLine>
            <CodeLine n={6} hot><span className="load-highlight">        raw_text = target_path.read_text(encoding=<span className="str">"utf-8"</span>)</span></CodeLine>
            <CodeLine n={7} hot><span className="load-highlight">        parsed_data = json.loads(raw_text)</span></CodeLine>
            <CodeLine n={8}>    <span className="kw">except</span> json.JSONDecodeError <span className="kw">as</span> exc:</CodeLine>
            <CodeLine n={9}>        <span className="kw">raise</span> ValueError(...) <span className="kw">from</span> exc</CodeLine>
            <CodeLine n={10} hot><span className="load-highlight">    <span className="kw">if not</span> isinstance(parsed_data, list): ...</span></CodeLine>
            <CodeLine n={11} hot><span className="load-highlight">    <span className="kw">return</span> [_validate_stock_record(item, idx) <span className="kw">for</span> idx, item <span className="kw">in</span> enumerate(parsed_data)]</span></CodeLine>
          </> : <>
            <div className="subheading"><span className="file-tag">LOOKUP</span> find_stock(ticker)</div>
            <CodeLine n={1} hot={lookup}><span className="kw">def</span> <span className="fn">find_stock</span>(ticker: str):</CodeLine>
            <CodeLine n={2}>    <span className="kw">if not</span> isinstance(ticker, str):</CodeLine>
            <CodeLine n={3}>        <span className="kw">return</span> <span className="const">None</span></CodeLine>
            <CodeLine n={4}>    normalized_ticker = ticker.strip()</CodeLine>
            <CodeLine n={5}>    <span className="kw">if not</span> normalized_ticker:</CodeLine>
            <CodeLine n={6}>        <span className="kw">return</span> <span className="const">None</span></CodeLine>
            <CodeLine n={7}>    normalized_lower = normalized_ticker.lower()</CodeLine>
            <CodeLine n={8} hot={lookup}>    <span className="kw">for</span> record <span className="kw">in</span> <span className="fn">load_stocks</span>():</CodeLine>
            <CodeLine n={9} hot={match}>        <span className="kw">if</span> record[<span className="str">"ticker"</span>].strip().lower() == normalized_lower:</CodeLine>
            <CodeLine n={10} hot={match}>            <span className="kw">return</span> dict(record)</CodeLine>
            <CodeLine n={11}>    <span className="kw">return</span> <span className="const">None</span></CodeLine>
          </>}
          <div className="load-call"><span className={`load-pulse ${validate ? 'pulsing' : ''}`}/>{validate ? 'data/stocks.json' : 'load_stocks()'} <span>{validate ? 'read as UTF-8 · parsed as JSON list' : 'returns validated local records'}</span></div>
        </div>
      </div>
      <div className="editor-window json-editor">
        <Chrome name="data / stocks.json" badge="JSON · FIXTURE"/>
        <div className="json-toolbar"><span>3 RECORDS</span><span>UTF-8</span></div>
        <div className="json-content">
          <div className="json-line"><span className="ln">1</span><span>[</span></div>
          <div className={`record ${match ? 'record-match' : ''}`}>
            <div className="json-line"><span className="ln">2</span><span>{'{'}</span></div>
            <div className="json-line"><span className="ln">3</span><span>&nbsp; <i>"ticker"</i>: <b>"tAAPL"</b>,</span></div>
            <div className="json-line"><span className="ln">4</span><span>&nbsp; <i>"stock"</i>: <b>"Test Apple"</b>,</span></div>
            <div className="json-line"><span className="ln">5</span><span>&nbsp; <i>"reference_value"</i>: <b>230.0</b>,</span></div>
            <div className="json-line"><span className="ln">6</span><span>&nbsp; <i>"token_address"</i>: <b>""</b></span></div>
            <div className="json-line"><span className="ln">7</span><span>{'}'}</span></div>
            {match && <div className="match-label"><span className="green-dot"/>MATCH · case-insensitive ticker comparison</div>}
          </div>
          <div className="json-line dim-row"><span className="ln">8</span><span>,</span></div>
          <div className="json-line other-record"><span className="ln">9</span><span>{'{ "ticker": "tTSLA", "stock": "Test Tesla", ... },'}</span></div>
          <div className="json-line other-record"><span className="ln">10</span><span>{'{ "ticker": "tNVDA", "stock": "Test Nvidia", ... }'}</span></div>
          <div className="json-line"><span className="ln">11</span><span>]</span></div>
        </div>
        <div className="fixture-stamp"><span className="status-dot"/> LOCAL FIXTURE · NO LIVE FEED</div>
      </div>
    </div>
    <div className="lookup-steps"><span className={validate ? 'step-on' : ''}><b>1</b> read file</span><i>→</i><span className={validate ? 'step-on' : ''}><b>2</b> validate records</span><i>→</i><span className={match ? 'step-on' : ''}><b>3</b> compare ticker</span><i>→</i><span className={match ? 'step-on' : ''}><b>4</b> return dictionary</span></div>
  </div>;
};

const SceneView: React.FC<{index: number; frame: number}> = ({index, frame}) => {
  if (index === 0) return <ClientScene frame={frame} returning={frame >= 470}/>;
  if (index === 1) return <ServerScene frame={frame}/>;
  return <DataScene frame={frame}/>;
};

export const KyroxMotion: React.FC = () => {
  const frame = useCurrentFrame();
  const cameraX = interpolate(frame, [0, 112, 147, 242, 280, 447, 490, 660], [0, 0, W, W, W*2, W*2, 0, 0], { ...clamp, easing: smooth });
  const tickerWorldX = interpolate(frame, [0, 90, 160, 230, 242, 280, 300, 380, 450, 490, 535, 660], [1120, 1390, 2120, 2450, 2270, 4190, 4300, 4200, 4200, 1120, 1150, 1120], {...clamp, easing: smooth});
  const tokenOpacity = interpolate(frame, [12, 25, 620, 650], [0, 1, 1, 0], clamp);
  const titleOpacity = interpolate(frame, [0, 15, 78, 110], [0, 1, 1, 0.6], clamp);
  return <AbsoluteFill className="canvas">
    <div className="ambient-grid"/>
    <div className="topbar"><div className="brand"><span className="brand-mark">K</span><span>KYROX <small>ENGINEERING NOTES</small></span></div><div className="topbar-center"><span className="live-indicator"/> TOOL EXECUTION TRACE <b>·</b> 22 SEC</div><div className="topbar-right">MCP / PYTHON <span>01</span></div></div>
    <Progress frame={frame}/>
    <div className="scene-viewport">
      <div className="world" style={{transform: `translate3d(${-cameraX}px,0,0)`}}>
        {[0,1,2].map((idx) => <div className="scene-slot" style={{left: `${idx*W}px`}} key={idx}><SceneView index={idx} frame={frame}/></div>)}
        <div className="ticker-route"><span className="route-start"/><span className="route-line"/><span className="route-end"/></div>
        <div className="ticker-token" style={{left: tickerWorldX, opacity: tokenOpacity}}><span className="token-arrow">→</span><span>tAAPL</span><small>LOOKUP KEY</small></div>
      </div>
    </div>
    <div className="lowerbar"><div className="lower-left" style={{opacity: titleOpacity}}>GET_STOCK_INFO <span>/</span> tAAPL</div><div className="disclaimer">LOCAL DEMO DATA — NOT LIVE MARKET PRICES</div><div className="lower-right">KYROX <span>·</span> TRACE 001</div></div>
    <div className="frame-tick"><span style={{transform: `scaleX(${frame/660})`}}/></div>
  </AbsoluteFill>;
};
