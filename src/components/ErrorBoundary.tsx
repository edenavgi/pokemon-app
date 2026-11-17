import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props { children: ReactNode }
interface State { error: Error | null }

/** Last line of defence: an unexpected error shows a readable message instead of a blank page. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div role="alert" className="m-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
        <p className="font-medium">Something went wrong</p>
        <p className="mt-1 font-mono text-xs break-words">{this.state.error.message}</p>
      </div>
    )
  }
}
