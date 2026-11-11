import { useEffect, useLayoutEffect, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'
import { NS } from './locales.ts'
import { MobileIcon } from './MobileIcon.tsx'
import { resolveMobileIcons } from './icon-compat.mjs'
import {
  DRAWER_SELECTOR,
  TOGGLE_SELECTOR,
  isOverlayTap,
  navTargetFor,
} from './nav-targets.mjs'

/** 宿主图标在加载时解析一次：不同 DSH 版本的导出名不同（见 icon-compat.mjs）。 */
const icons = resolveMobileIcons(primitives)

/** Full props for the shell overlay entry. */
export interface MobileNavOverlayProps extends PropsRuntime<'shell.overlay'>, PropsLocale<typeof NS> {
  /** Bound ctx.layout.toggleSidebar(). */
  toggleSidebar: () => void
}

/** Same breakpoint as the shell's SIDEBAR_AUTO_COLLAPSE (viewport < 1024). */
const MOBILE_QUERY = '(max-width: 1023px)'

/** Live matchMedia hook for the narrow breakpoint. */
function useMobile(): boolean {
  const [mobile, setMobile] = useState(() => window.matchMedia(MOBILE_QUERY).matches)
  useEffect(() => {
    const query = window.matchMedia(MOBILE_QUERY)
    const onChange = (event: MediaQueryListEvent) => setMobile(event.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  return mobile
}

/** The AppFrame element: direct parent of the shell overlay layer. */
function findFrame(): HTMLElement | null {
  return document.querySelector('[data-shell-overlay]')?.parentElement ?? null
}

/**
 * Mobile shell overlay: owns the `data-mobile-nav` marker on the AppFrame
 * element (the CSS restructure keys off it), mirrors the frame's collapsed
 * state into React state, and renders the dimmed backdrop plus a floating
 * directory button for the hero/blank phases that have no session header.
 */
export function MobileNavOverlay({ toggleSidebar, t }: MobileNavOverlayProps) {
  const mobile = useMobile()
  const [open, setOpen] = useState(false)
  const [fabVisible, setFabVisible] = useState(false)

  // Frame ownership + open-state mirror. On wide screens this effect is inert:
  // the marker is never set, so the layout is untouched.
  useLayoutEffect(() => {
    if (!mobile) {
      setOpen(false)
      return
    }
    const frame = findFrame()
    if (frame === null) return
    frame.setAttribute('data-mobile-nav', 'frame')

    // frame 直接子元素的语义标记（issue：DSH 0.2.2 起手机正文空白）。
    //
    // 历史：mobile.css 用 `[data-mobile-nav="frame"] > :nth-child(2)` 拉主内容列、
    // `> :first-child` 做侧栏抽屉——都依赖「第 N 个子元素」的位置约定。
    // DSH 0.2.2 的 AppFrame 在首位插入了 drawerMask，子元素全体右移一位：
    //   - nth-child(2) 命中了 sidebarCol，centerCol 仍留在被压缩成 0px 的第 2 轨
    //     → 手机上整个正文区空白（抽屉恰因官方 0.2.2 自带样式而侥幸正常）；
    //   - :first-child 命中了 drawerMask（空遮罩），pocket 的 z-index 1200/背景等
    //     抽屉规则全部错位——遮罩拿不到提升，侧栏靠官方 z 71 在跑，会被第三方
    //     图层（linxin666 的 1050~1100）盖掉点击（issue #67 复发）。
    // 修法：按「语义特征」识别并打标，CSS/JS 只认标记，与子元素顺序彻底解耦。
    //
    // 主内容列（两代宿主均成立、frame 内唯一）：显式落在第 2 列
    // （grid-column-start:2）+ 文档流内（position:static）+ display:flex。
    // 侧栏列（两代均成立、唯一）：React 以 prop 下发、渲染为内联 style.width
    // （~280px）——其余格子都没有内联宽度。
    const markFrameChildren = (): void => {
      const isCenterTrack = (el: HTMLElement): boolean =>
        el.style.gridColumnStart === '2' || getComputedStyle(el).gridColumnStart === '2'
      const isSidebarTrack = (el: HTMLElement): boolean =>
        el.style.gridColumnStart === '1' || getComputedStyle(el).gridColumnStart === '1'
      let centerMarked = false
      let drawerMarked = false
      for (const el of Array.from(frame.children)) {
        if (!(el instanceof HTMLElement)) continue
        // 已带标记的直接计入：主内容列被我们的规则拉回第 1 轨后，computed
        // grid-column-start 会变成 1，若仍按原判据扫描就会「识别不出自己改过的元素」。
        if (el.hasAttribute('data-mobile-nav-center')) centerMarked = true
        if (el.hasAttribute('data-mobile-nav-drawer')) drawerMarked = true
        // 侧栏列：落在第 1 列 + 带内联像素宽度
        if (isSidebarTrack(el) && /^\d+(\.\d+)?px$/.test(el.style.width)) {
          el.setAttribute('data-mobile-nav-drawer', '1')
          drawerMarked = true
        }
        // 主内容列：第 2 列 + static + flex
        if (isCenterTrack(el)) {
          const cs = getComputedStyle(el)
          if (cs.position === 'static' && cs.display === 'flex') {
            el.setAttribute('data-mobile-nav-center', '1')
            centerMarked = true
          }
        }
      }
      // 兜底一（主内容列）：官方若改掉 display/position，退为「第 2 列 + 非绝对定位」。
      if (!centerMarked) {
        for (const el of Array.from(frame.children)) {
          if (!(el instanceof HTMLElement)) continue
          if (!isCenterTrack(el)) continue
          if (getComputedStyle(el).position === 'absolute') continue
          el.setAttribute('data-mobile-nav-center', '1')
        }
      }
      // 兜底二（主内容列）：仍没认出来时，按网格「文档流内的第 2 列」再找一次；
      // 再失败就放弃（宁可不改布局，也不能像 nth-child 漂移那样指错人）。
      // 兜底三（侧栏列）：退为「包含会话树 [role=tree] 的格子」——抽屉宁可少一层
      // 样式（官方抽屉仍在），不能把遮罩当抽屉打扮。
      if (!drawerMarked) {
        for (const el of Array.from(frame.children)) {
          if (!(el instanceof HTMLElement)) continue
          if (!el.querySelector('[role="tree"]')) continue
          el.setAttribute('data-mobile-nav-drawer', '1')
          break
        }
      }
    }
    markFrameChildren()

    const sync = () => setOpen(!frame.hasAttribute('data-sidebar-collapsed'))
    sync()
    // childList：React 重渲染会替换 frame 的子元素（会话切换/面板挂载），
    // 只观察 attributes 会漏掉新插入且未带标记的列。
    const observer = new MutationObserver(() => {
      sync()
      markFrameChildren()
    })
    observer.observe(frame, {
      attributes: true,
      attributeFilter: ['data-sidebar-collapsed'],
      childList: true,
    })
    return () => {
      observer.disconnect()
      frame.removeAttribute('data-mobile-nav')
      frame
        .querySelectorAll('[data-mobile-nav-center],[data-mobile-nav-drawer]')
        .forEach((el) => {
          el.removeAttribute('data-mobile-nav-center')
          el.removeAttribute('data-mobile-nav-drawer')
        })
    }
  }, [mobile])

  // The floating button is a fallback for surfaces without a session header:
  // phase "active" means the header (and its toggle) is rendered already.
  useEffect(() => {
    if (!mobile) {
      setFabVisible(false)
      return
    }
    const sync = () => setFabVisible(document.querySelector('[data-phase="active"]') === null)
    sync()
    const observer = new MutationObserver(sync)
    // childList: the conversation root can be replaced wholesale on session
    // switches, so attribute-only observation would miss the new phase.
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-phase'],
    })
    return () => observer.disconnect()
  }, [mobile])

  // Escape closes the drawer — but yields to an open modal dialog (e.g. the
  // settings panel), which owns its own Escape handling.
  useEffect(() => {
    if (!mobile || !open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && document.querySelector('[aria-modal="true"]') === null) toggleSidebar()
    }
    // Capture phase: run before the settings panel's own document-bubble Escape
    // handler, so the modal is still present when we yield to it.
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [mobile, open, toggleSidebar])

  // Navigation inside the drawer closes it: tapping a session row or a
  // plugin takeover entry (task board / ssh) must hand the screen to the
  // content it just opened. Mouse clicks keep the direct close path. Touch
  // session rows close only after aria-selected changes, so live session
  // updates cannot strand a delayed click on a detached DOM target.
  //
  // Deliberately NOT closed by this rule:
  // - Settings / Session log: their dialogs render INSIDE the drawer DOM
  //   (portaled into the sidebar); closing the drawer would slide the dialog
  //   off-screen with it.
  // - Workspace folder rows (YDXeBa_projectRow), the logo: pure UI toggles,
  //   not navigation — see NAV_TARGETS in nav-targets.mjs.
  // - Anything while a modal dialog is open: the dialog owns the screen.
  useEffect(() => {
    if (!mobile || !open) return
    let lastTouchNavAt = 0
    let lastTouchX = 0
    let lastTouchY = 0
    let suppressTouchClickUntil = 0
    let pendingTouchRow: Element | null = null
    let selectedRowAtArm: Element | null = null
    let navClickArrived = false
    let navObserver: MutationObserver | null = null
    let navTimer: number | null = null

    const drawerRoot = (): HTMLElement | null =>
      document.querySelector<HTMLElement>(DRAWER_SELECTOR)

    const disarmNav = (): void => {
      navObserver?.disconnect()
      navObserver = null
      if (navTimer !== null) window.clearTimeout(navTimer)
      navTimer = null
      pendingTouchRow = null
      selectedRowAtArm = null
      navClickArrived = false
    }

    const armNav = (row: Element): void => {
      disarmNav()
      pendingTouchRow = row
      const drawer = drawerRoot()
      selectedRowAtArm = drawer?.querySelector('[role="treeitem"][aria-selected="true"]') ?? null
      if (drawer === null) return
      navObserver = new MutationObserver(() => {
        const frame = document.querySelector('[data-mobile-nav="frame"]')
        if (frame === null || frame.hasAttribute('data-sidebar-collapsed')) {
          disarmNav()
          return
        }
        const selectedRow = drawerRoot()?.querySelector('[role="treeitem"][aria-selected="true"]') ?? null
        if (navClickArrived && selectedRow !== null && selectedRow !== selectedRowAtArm) {
          disarmNav()
          toggleSidebar()
        }
      })
      navObserver.observe(drawer, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['aria-selected'],
      })
      navTimer = window.setTimeout(disarmNav, 2000)
    }

    const navigationTarget = (target: EventTarget | null): Element | null => {
      if (document.querySelector('[aria-modal="true"]') !== null) return null
      const frame = document.querySelector('[data-mobile-nav="frame"]')
      if (frame === null || frame.hasAttribute('data-sidebar-collapsed')) return null
      if (!(target instanceof Element)) return null
      const drawer = drawerRoot()
      if (drawer === null || !drawer.contains(target)) return null
      return navTargetFor(target)
    }

    const isPendingTouchClick = (event: MouseEvent): boolean => {
      const capabilities = (event as MouseEvent & {
        sourceCapabilities?: { firesTouchEvents?: boolean }
      }).sourceCapabilities
      if (capabilities?.firesTouchEvents === true) return true
      return Math.hypot(event.clientX - lastTouchX, event.clientY - lastTouchY) <= 24
    }

    const onDrawerClick = (event: MouseEvent): void => {
      // A touch row tap owns the close through the selection observer. Let the
      // browser click reach React without a capture-phase close racing it.
      if (performance.now() < suppressTouchClickUntil) return
      if (
        pendingTouchRow !== null
        && performance.now() - lastTouchNavAt < 500
        && isPendingTouchClick(event)
      ) {
        const target = navigationTarget(event.target)
        const row = target?.closest('[role="treeitem"]')
        if (row !== null && row !== undefined) {
          pendingTouchRow = row
          navClickArrived = true
          return
        }
      }
      if (navigationTarget(event.target) !== null) toggleSidebar()
    }

    const onDrawerPointerUp = (event: PointerEvent): void => {
      if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return
      const target = navigationTarget(event.target)
      if (target === null) return

      const row = target.closest('[role="treeitem"]')
      if (row !== null) {
        if (row.getAttribute('aria-selected') === 'true') {
          // Already-selected rows will not navigate; closing now is safe.
          suppressTouchClickUntil = performance.now() + 500
          toggleSidebar()
        } else {
          // Let React navigate first, then close on the selection mutation.
          lastTouchNavAt = performance.now()
          lastTouchX = event.clientX
          lastTouchY = event.clientY
          armNav(row)
        }
        return
      }

      // Non-row targets keep their existing click path; only host
      // session/search rows participate in the selected-state hand-off.
    }

    document.addEventListener('click', onDrawerClick, true)
    document.addEventListener('pointerup', onDrawerPointerUp, true)
    return () => {
      disarmNav()
      document.removeEventListener('click', onDrawerClick, true)
      document.removeEventListener('pointerup', onDrawerPointerUp, true)
    }
  }, [mobile, open, toggleSidebar])

  // Tap-outside closes the drawer (issue #38). The backdrop is now
  // pointer-events: none (pure dimming layer that never steals clicks), so
  // "tap the dimmed area to close" moves here: any click outside the drawer
  // (and outside the header toggle) closes it, keeping the standard
  // interaction while letting drawer contents receive clicks normally.
  // Capture phase: the close happens before the content processes the tap
  // (same first-tap-closes behaviour as before).
  useEffect(() => {
    if (!mobile || !open) return
    const onOutsideClick = (event: MouseEvent) => {
      if (document.querySelector('[aria-modal="true"]') !== null) return
      const target = event.target as HTMLElement | null
      if (target === null) return
      if (target.closest(TOGGLE_SELECTOR) !== null) return
      // Portaled overlays (issue #72): the workspace section's "视图选项" /
      // "添加工作区" and the session row kebab all open menus that live on
      // document.body — outside the drawer DOM. Without this exemption the
      // first tap on a menu item is eaten: the drawer slides away, the menu
      // unmounts with the sidebar, and the item's onClick never runs, so
      // every workspace control reads as "点了没反应" on a phone.
      if (isOverlayTap(target)) return
      const frame = document.querySelector('[data-mobile-nav="frame"]')
      if (frame === null || frame.hasAttribute('data-sidebar-collapsed')) return
      const drawer = document.querySelector<HTMLElement>(DRAWER_SELECTOR)
      if (drawer !== null && drawer.contains(target)) return
      toggleSidebar()
    }
    document.addEventListener('click', onOutsideClick, true)
    return () => document.removeEventListener('click', onOutsideClick, true)
  }, [mobile, open, toggleSidebar])

  if (!mobile) return null
  return (
    <>
      {open && (
        <div data-mobile-nav="backdrop" />
      )}
      {fabVisible && !open && (
        <button
          type="button"
          data-mobile-nav="fab"
          aria-label={t('open')}
          title={t('open')}
          onClick={() => toggleSidebar()}
        >
          <MobileIcon icon={icons.panelLeft} name="panelLeft" size={18} />
        </button>
      )}
    </>
  )
}
