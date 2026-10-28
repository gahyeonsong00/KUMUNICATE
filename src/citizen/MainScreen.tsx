import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { DECO_MAP, deleteLatestDecoration, loadDecorations, submitComplaint } from './api'
import type { Toast } from './CitizenApp'
import { MAP_H, MAP_W, PLACES, nearestPlace, type Place } from './places'
import { MAX_BYTE, countBytes, errorText } from './util'
import ChatPopup from './ChatPopup'
import Decorate, { type DecoItem } from './Decorate'
import mapImage from '../../assets/map_final.png'
import mascotPair from '../../assets/mascot_pair.png'

const MAP_START = { left: 150, top: 300 } // 지도 처음 스크롤 위치 (사색의 광장 쪽)
const MAX_PHOTOS = 3
const MAX_ZOOM = 3 // 지도 그림이 원본 6028px라 3배까지 선명

// 저장한 꾸미기를 지도에 겹칠 때: 가운데 80%는 그대로, 바깥 10%씩은 아래 지도와 부드럽게 섞음
const DECO_MASK = 'linear-gradient(to right,transparent,#000 10%,#000 90%,transparent),linear-gradient(to bottom,transparent,#000 10%,#000 90%,transparent)'

type Pin = { x: number; y: number; place: Place }
type Props = { userId: string; hidden: boolean; toast: Toast; onOpenActivity: () => void; onLogout: () => void }

// 종 아이콘 (rect만 사용한 픽셀 SVG)
const Bell = () => (
  <svg width="20" height="20" viewBox="0 0 10 10" shapeRendering="crispEdges" fill="#3A2617">
    <rect x="4" y="0" width="2" height="1" /><rect x="3" y="1" width="4" height="1" />
    <rect x="2" y="2" width="6" height="4" /><rect x="1" y="6" width="8" height="1" />
    <rect x="4" y="8" width="2" height="1" />
  </svg>
)

// 메인 지도 화면: 민원 모드(핀 → 작성 시트) / 꾸미기 모드(핀 → + → 프롬프트 창)
export default function MainScreen({ userId, hidden, toast, onOpenActivity, onLogout }: Props) {
  const [mode, setMode] = useState<'complaint' | 'decorate'>('complaint')
  const [pin, setPin] = useState<Pin | null>(null)
  const [text, setText] = useState('')
  const [photos, setPhotos] = useState<{ file: File; url: string }[]>([])
  const [sheetBig, setSheetBig] = useState(false)
  const [saving, setSaving] = useState(false)
  const [showDone, setShowDone] = useState(false)
  const [showChat, setShowChat] = useState(false)
  // 꾸미기 기록 = 서버에 저장된 내 꾸미기 (최신이 맨 앞). 꾸미기 모드에서 지도 위에 겹쳐 보여 준다 = 내 지도
  const [history, setHistory] = useState<DecoItem[]>([])
  // 확대·축소 배율. 지도 판 크기 = MAP_W × zoom
  const [zoom, setZoom] = useState(1)
  const zoomRef = useRef(1)
  const zoomAnchor = useRef<{ fx: number; fy: number; ox: number; oy: number } | null>(null)
  const [decoPanel, setDecoPanel] = useState<'none' | 'deco' | 'history' | 'reset'>('none')

  const scrollRef = useRef<HTMLDivElement>(null)
  const boardRef = useRef<HTMLDivElement>(null)
  const sheetRef = useRef<HTMLDivElement>(null)
  const areaRef = useRef<HTMLDivElement>(null)
  const photoInput = useRef<HTMLInputElement>(null)
  const suppressClick = useRef(false)

  const deco = mode === 'decorate'
  const sheetOpen = !deco && !!pin
  const bytes = countBytes(text)
  const mapW = MAP_W * zoom
  const mapH = MAP_H * zoom

  const reloadDecorations = async () => {
    try { setHistory(await loadDecorations()) } catch (e) { toast(errorText(e, '내 꾸미기를 불러오지 못했어요')) }
  }
  // 꾸미기 모드를 켜면 내 지도(원본 + 저장한 꾸미기)를 불러온다
  useEffect(() => { if (deco) reloadDecorations() }, [deco]) // eslint-disable-line react-hooks/exhaustive-deps

  const resetMapScroll = () => {
    const s = scrollRef.current
    if (s) { s.scrollLeft = MAP_START.left; s.scrollTop = MAP_START.top }
  }
  useEffect(resetMapScroll, [])

  // 시트가 열려 있는 동안 지도 판 아래에 시트 높이만큼 여백을 줌 (끝까지 스크롤할 수 있게)
  useLayoutEffect(() => {
    if (boardRef.current) boardRef.current.style.paddingBottom = sheetOpen ? `${sheetRef.current?.offsetHeight ?? 0}px` : '0px'
  }, [sheetOpen, sheetBig])

  // 핀이 "시트 위쪽에 남은 지도 영역"의 세로 가운데쯤 오도록 부드럽게 스크롤
  useEffect(() => {
    if (!sheetOpen || !pin) return
    const visibleH = (areaRef.current?.clientHeight ?? 0) - (sheetRef.current?.offsetHeight ?? 0)
    scrollRef.current?.scrollTo({ top: Math.max(0, pin.y * mapH - visibleH / 2), behavior: 'smooth' })
  }, [sheetOpen, pin]) // eslint-disable-line react-hooks/exhaustive-deps

  // 확대·축소: 마우스 휠(PC), 두 손가락 벌리기·오므리기(폰). 손가락·마우스 밑의 자리가 그대로 남게 스크롤을 맞춘다
  // 가장 작게 해도 지도가 화면을 꽉 채운다
  useEffect(() => {
    const s = scrollRef.current, area = areaRef.current
    if (!s || !area) return
    const zoomAt = (z: number, cx: number, cy: number) => {
      const min = Math.max(area.clientWidth / MAP_W, area.clientHeight / MAP_H)
      z = Math.min(MAX_ZOOM, Math.max(min, z))
      if (Math.abs(z - zoomRef.current) < 0.001) return
      const r = s.getBoundingClientRect()
      const ox = cx - r.left, oy = cy - r.top
      zoomAnchor.current = {
        fx: (s.scrollLeft + ox) / (MAP_W * zoomRef.current), fy: (s.scrollTop + oy) / (MAP_H * zoomRef.current), ox, oy,
      }
      zoomRef.current = z
      setZoom(z)
    }
    const wheel = (e: WheelEvent) => { e.preventDefault(); zoomAt(zoomRef.current * Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY) }
    let pinch: { gap: number; zoom: number } | null = null
    const gap = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)
    const tStart = (e: TouchEvent) => { if (e.touches.length === 2) pinch = { gap: gap(e.touches), zoom: zoomRef.current } }
    const tMove = (e: TouchEvent) => {
      if (!pinch || e.touches.length !== 2) return
      e.preventDefault()
      const t = e.touches
      zoomAt(pinch.zoom * gap(t) / pinch.gap, (t[0].clientX + t[1].clientX) / 2, (t[0].clientY + t[1].clientY) / 2)
    }
    const tEnd = (e: TouchEvent) => { if (e.touches.length < 2) pinch = null }
    s.addEventListener('wheel', wheel, { passive: false })
    s.addEventListener('touchstart', tStart, { passive: true })
    s.addEventListener('touchmove', tMove, { passive: false })
    s.addEventListener('touchend', tEnd)
    return () => {
      s.removeEventListener('wheel', wheel)
      s.removeEventListener('touchstart', tStart)
      s.removeEventListener('touchmove', tMove)
      s.removeEventListener('touchend', tEnd)
    }
  }, [])
  // 배율이 바뀐 뒤(다시 그린 뒤) 기준점이 제자리에 오도록 스크롤
  useLayoutEffect(() => {
    const a = zoomAnchor.current, s = scrollRef.current
    if (!a || !s) return
    s.scrollLeft = a.fx * mapW - a.ox
    s.scrollTop = a.fy * mapH - a.oy
    zoomAnchor.current = null
  }, [zoom]) // eslint-disable-line react-hooks/exhaustive-deps

  // 마우스로 끌어서 스크롤 (PC용). 폰의 손가락 스크롤은 브라우저 기본 동작 그대로
  useEffect(() => {
    const s = scrollRef.current
    if (!s) return
    let drag: { x: number; y: number; left: number; top: number } | null = null
    let dragged = false
    const down = (e: MouseEvent) => {
      if (e.button !== 0) return
      drag = { x: e.clientX, y: e.clientY, left: s.scrollLeft, top: s.scrollTop }
      dragged = false
    }
    const move = (e: MouseEvent) => {
      if (!drag) return
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y
      if (!dragged && Math.hypot(dx, dy) > 5) dragged = true // 5px 넘으면 끌기
      if (dragged) { s.scrollLeft = drag.left - dx; s.scrollTop = drag.top - dy }
    }
    const up = () => {
      if (!drag) return
      drag = null
      if (dragged) { suppressClick.current = true; setTimeout(() => { suppressClick.current = false }, 0) }
    }
    const noDrag = (e: DragEvent) => e.preventDefault()
    s.addEventListener('mousedown', down)
    s.addEventListener('dragstart', noDrag)
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      s.removeEventListener('mousedown', down)
      s.removeEventListener('dragstart', noDrag)
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [])

  // 시트 닫기: 핀 지우기 + 입력 내용 비우기
  const closeSheet = () => {
    setPin(null)
    setText('')
    photos.forEach((p) => URL.revokeObjectURL(p.url))
    setPhotos([])
    setSheetBig(false)
  }

  // 모드를 바꾸면 핀과 작성 중이던 민원 시트는 사라짐
  const changeMode = (m: 'complaint' | 'decorate') => {
    closeSheet()
    setMode(m)
  }

  // 지도 판 click (손가락으로 끌어서 스크롤한 것은 click이 아니므로 자동으로 제외됨)
  const onBoardClick = (e: React.MouseEvent) => {
    if (suppressClick.current || !boardRef.current) return
    const r = boardRef.current.getBoundingClientRect()
    // 누른 곳을 지도 판 기준 0~1 비율로 (아래 여백은 지도가 아니므로 지도 크기로 나눔)
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / mapW))
    const y = Math.min(1, Math.max(0, (e.clientY - r.top) / mapH))
    setPin({ x, y, place: nearestPlace(x, y) })
  }

  const addPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (file.size > 10 * 1024 * 1024) { toast('사진은 한 장에 10MB까지 올릴 수 있어요'); return }
    setPhotos((ps) => [...ps, { file, url: URL.createObjectURL(file) }].slice(0, MAX_PHOTOS))
  }

  const removePhoto = (i: number) => {
    setPhotos((ps) => {
      URL.revokeObjectURL(ps[i].url)
      return ps.filter((_, j) => j !== i)
    })
  }

  const submit = async () => {
    const content = text.trim()
    if (saving || !pin || !content || countBytes(content) > MAX_BYTE) return
    setSaving(true)
    try {
      await submitComplaint(userId, {
        content, buildingId: pin.place.buildingId, photos: photos.map((p) => p.file), channel: 'form',
      })
      closeSheet()
      setShowDone(true)
    } catch (e) {
      toast(errorText(e, '접수에 실패했어요. 다시 시도해 주세요'))
    } finally {
      setSaving(false)
    }
  }

  const notice = deco
    ? (pin ? '+를 눌러 꾸며보세요' : '꾸미고 싶은 곳을 눌러보세요')
    : (pin ? null : '지도를 눌러 민원 위치를 선택하세요')

  return (
    <div id="mainScreen" className="screen" style={hidden ? { display: 'none' } : undefined}>
      <div id="topBar" className="panel">
        <button className="btn3 ib" type="button" aria-label={deco ? '민원 모드로' : '로그아웃'}
          onClick={() => (deco ? changeMode('complaint') : onLogout())}>←</button>
        <span id="topTitle">경희대 키우기</span>
        <button className="btn3 ib" type="button" aria-label={deco ? '꾸미기 기록' : '나의 활동'}
          onClick={() => (deco ? setDecoPanel('history') : onOpenActivity())}>{deco ? '≡' : <Bell />}</button>
      </div>

      {/* 지도 영역: 나중에 진짜 지도로 바꿀 수 있게 하나로 감쌈 */}
      <div id="mapArea" ref={areaRef}>
        <div id="mapScroll" ref={scrollRef}>
          <div id="mapBoard" ref={boardRef} onClick={onBoardClick} style={{ width: mapW, height: mapH }}>
            <img className="crisp" src={mapImage} alt="캠퍼스 지도" draggable={false} style={{ width: mapW, height: mapH }} />
            {/* 꾸미기 모드: 내 지도 = 저장한 꾸미기를 오래된 것부터 겹침 (최신이 위) */}
            {deco && history.slice().reverse().map((h) => {
              const k = mapW / DECO_MAP.w
              return (
                <img key={h.id} className="decoLayer" src={h.afterUrl} alt="" draggable={false}
                  style={{
                    position: 'absolute', pointerEvents: 'none', left: h.bounds.x * k, top: h.bounds.y * k,
                    width: h.bounds.size * k, height: h.bounds.size * k,
                    WebkitMaskImage: DECO_MASK, WebkitMaskComposite: 'source-in', maskImage: DECO_MASK, maskComposite: 'intersect',
                  }} />
              )
            })}
            {/* 이름표는 민원 모드에서만 (꾸미기 모드에서는 지도만 보이게) */}
            {!deco && PLACES.map((p) => (
              <div key={p.name} className="tag" style={{ left: p.x * mapW, top: p.y * mapH }}>{p.name}</div>
            ))}
            {pin && (
              <div id="pin" className={deco ? 'deco' : undefined} style={{ left: pin.x * mapW, top: pin.y * mapH }}
                onClick={(e) => {
                  // 꾸미기 모드에서 핀을 누르면 프롬프트 창 (지도 click으로 번지지 않게 막음)
                  e.stopPropagation()
                  if (!suppressClick.current && deco) setDecoPanel('deco')
                }}>+</div>
            )}
          </div>
        </div>

        <div id="mapOverlay">
          <div id="modeCard" className="panel">
            <span>꾸미기</span>
            <button id="modeSwitch" className={deco ? 'on' : undefined} type="button" aria-label="꾸미기 모드 전환"
              onClick={() => changeMode(deco ? 'complaint' : 'decorate')}><i /></button>
          </div>
          <button className="btn3 sq" type="button" onClick={() => {
            zoomRef.current = 1
            setZoom(1)
            requestAnimationFrame(resetMapScroll)
            toast('지도를 처음 위치로 되돌렸어요')
          }}>N</button>
          {deco && (
            <button className="btn3 sq" type="button" aria-label="되돌리기" onClick={async () => {
              if (history.length === 0) { toast('되돌릴 꾸미기가 없어요'); return }
              const last = history[0] // 가장 최근 꾸미기 하나만 원본으로
              try {
                await deleteLatestDecoration(last.id)
                await reloadDecorations()
                toast(`'${last.title}' 되돌림`)
              } catch (e) {
                toast(errorText(e, '되돌리지 못했어요. 다시 시도해 주세요'))
              }
            }}>↶</button>
          )}
        </div>
        {notice && <div id="mapNotice">{notice}</div>}

        {/* 민원 작성 시트 (핀이 생기면 올라옴) */}
        {sheetOpen && (
          <div id="sheet" ref={sheetRef} className={`panel${sheetBig ? ' big' : ''}`}>
            <button id="handleBtn" type="button" aria-label="시트 크기 바꾸기" onClick={() => setSheetBig((b) => !b)}>
              <div id="handleBar" />
            </button>
            <div id="sheetTop">
              <span id="placePlate" className="plate">{pin.place.name}</span>
              <button id="sheetClose" className="btn3" type="button" aria-label="닫기" onClick={closeSheet}>✕</button>
            </div>
            <div id="photoRow">
              {photos.map((p, i) => (
                <div key={p.url} className="slot photoSlot">
                  <img className="crisp" src={p.url} alt={`첨부 사진 ${i + 1}`} />
                  <button className="btn3 x" type="button" aria-label="사진 빼기" onClick={() => removePhoto(i)}>✕</button>
                </div>
              ))}
              {photos.length < MAX_PHOTOS && (
                <button className="slot photoSlot" type="button" onClick={() => photoInput.current?.click()}>
                  + 사진 넣기{photos.length > 0 ? ` (${photos.length}/${MAX_PHOTOS})` : ''}
                </button>
              )}
            </div>
            <input ref={photoInput} type="file" accept="image/jpeg,image/png,image/webp,image/heic" hidden onChange={addPhoto} />
            <textarea id="complaintText" className="slot" placeholder="불편사항을 입력해주세요."
              value={text} onChange={(e) => setText(e.target.value)} />
            <div className="byteFoot">
              <span className={`byteCount${bytes > MAX_BYTE ? ' over' : ''}`}>{bytes}/{MAX_BYTE}byte</span>
              <button id="submitBtn" className="btn" type="button" onClick={submit}
                disabled={saving || !text.trim() || bytes > MAX_BYTE}>{saving ? '접수 중…' : '접수하기'}</button>
            </div>
          </div>
        )}
      </div>

      <div id="bottomBar">
        {deco
          ? <button id="resetBtn" className="btn3" type="button" onClick={() => setDecoPanel('reset')}>초기화</button>
          : <button id="chatBtn" className={sheetOpen ? 'btn3' : 'btn'} type="button" onClick={() => setShowChat(true)}>민원 접수 채팅</button>}
      </div>

      {showDone && (
        <div className="overlay center">
          <div id="doneBox" className="panel">
            <div id="doneHead" className="plate">민원 접수 완료!</div>
            <div id="doneBody">
              <img className="crisp bob" src={mascotPair} width={150} alt="쿠옹이와 쿠밍이" />
              <p>민원 접수가 완료되었습니다! 관련 부서로 전달해 신속히 해결하기 위해 노력하겠습니다. 민원 해결 현황은 '나의 활동'을 통해 확인해주세요.</p>
              <div className="twoBtns">
                <button className="btn3" type="button" onClick={() => setShowDone(false)}>닫기</button>
                <button className="btn" type="button" onClick={() => { setShowDone(false); onOpenActivity() }}>나의 활동 확인</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showChat && (
        <ChatPopup userId={userId} toast={toast} onClose={() => setShowChat(false)}
          onSubmitted={() => { setShowChat(false); setShowDone(true) }} />
      )}

      <Decorate
        userId={userId}
        toast={toast}
        panel={decoPanel}
        setPanel={setDecoPanel}
        place={pin?.place ?? null}
        pin={pin ? { x: pin.x, y: pin.y } : null}
        history={history}
        reload={reloadDecorations}
        onSaved={() => setPin(null)}
      />
    </div>
  )
}
