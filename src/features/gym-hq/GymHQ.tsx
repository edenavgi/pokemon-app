import { useApi } from '../../api/ApiProvider'
import type { BoardConfig } from '../../api/GameApi'
import { ErrorState, Loading } from '../../components/States'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs'
import { gymHqText as t } from '../../lib/messages'
import { useAppContext } from '../../lib/useAppContext'
import { useAsync } from '../../lib/useAsync'
import { RequireBoardConfig } from '../setup/RequireBoardConfig'
import { ArenaTab } from './ArenaTab'
import { GymsTab } from './GymsTab'
import { RecruitTab } from './RecruitTab'

export function GymHQ() {
  const ctx = useAppContext() // applies the monday theme (dark class) to the document
  if (!ctx) return <Loading />
  return <RequireBoardConfig>{(cfg) => <Hq cfg={cfg} />}</RequireBoardConfig>
}

function Hq({ cfg }: { cfg: BoardConfig }) {
  const api = useApi()
  const gymsState = useAsync(() => api.listGyms({ boardIds: [cfg.gymsBoardId] }), [api, cfg.gymsBoardId])
  const { data: gyms, error, reload } = gymsState

  if (error && !gyms) return <ErrorState error={error} onRetry={reload} />
  if (!gyms) return <Loading />

  return (
    <Tabs defaultValue="gyms" className="p-2">
      <TabsList>
        <TabsTrigger value="gyms">{t.tabs.gyms}</TabsTrigger>
        <TabsTrigger value="recruit">{t.tabs.recruit}</TabsTrigger>
        <TabsTrigger value="arena">{t.tabs.arena}</TabsTrigger>
      </TabsList>
      <TabsContent value="gyms"><GymsTab gyms={gyms} reload={reload} /></TabsContent>
      <TabsContent value="recruit"><RecruitTab gyms={gyms} reload={reload} /></TabsContent>
      <TabsContent value="arena"><ArenaTab gyms={gyms} /></TabsContent>
    </Tabs>
  )
}
