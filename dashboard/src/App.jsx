import { useState, useMemo, useEffect } from 'react'
import { useAllData } from './hooks/useAllData'
import SectorCards from './components/SectorCards'
import TechList from './components/TechList'
import TechDetail from './components/TechDetail'
import StatsView from './components/StatsView'
import SearchResults from './components/SearchResults'
import './App.css'

const DEFAULT_TECH_LIST_CONTROLS = {
  ageFilter: 'all',
  includeDeleted: false,
  sortBy: 'statute',
}

function DatasetToggle({ filter, onChange }) {
  return (
    <div className="dataset-toggle">
      <button
        className={`toggle-btn toggle-btn--strategic${filter === 'strategic' ? ' active' : ''}`}
        onClick={() => onChange('strategic')}
      >국가전략</button>
      <button
        className={`toggle-btn toggle-btn--growth${filter === 'growth' ? ' active' : ''}`}
        onClick={() => onChange('growth')}
      >신성장·원천</button>
    </div>
  )
}

export default function App() {
  const { data, loading } = useAllData()
  const [view, setView] = useState('card')          // 'card' | 'stats'
  const [filter, setFilter] = useState('strategic') // 'strategic' | 'growth'
  const [selectedSector, setSelectedSector] = useState(null)
  const [selectedTech, setSelectedTech] = useState(null)
  const [techListControls, setTechListControls] = useState(DEFAULT_TECH_LIST_CONTROLS)
  const [search, setSearch] = useState('')

  const isSearching = search.trim().length > 0

  useEffect(() => {
    if (selectedTech) {
      requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'auto' }))
    }
  }, [selectedTech])

  const handleSearchSelect = (tech, type) => {
    setSelectedSector({
      key: `${type}::${tech.sector_key}`,
      type,
      name: tech.sector_name,
      sectorKey: tech.sector_key,
      sectorNumber: parseInt(tech.sector_number, 10) || 999,
    })
    setSelectedTech(tech)
    setTechListControls(DEFAULT_TECH_LIST_CONTROLS)
    setView('card')
    setSearch('')
  }

  const handleRelatedTechSelect = (tech, type) => {
    handleSearchSelect(tech, type)
  }

  const goToCardView = (targetFilter) => {
    setView('card')
    setFilter(targetFilter)
    setSelectedSector(null)
    setSelectedTech(null)
    setTechListControls(DEFAULT_TECH_LIST_CONTROLS)
    setSearch('')
  }

  const handleSectorSelect = (sector) => {
    setSelectedSector(sector)
    setSelectedTech(null)
    setTechListControls(DEFAULT_TECH_LIST_CONTROLS)
    requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
  }

  const handleRelatedSectorSelect = (sector) => {
    setFilter(sector.type)
    handleSectorSelect(sector)
  }

  const handleSectorBack = () => {
    setSelectedSector(null)
    setSelectedTech(null)
    setTechListControls(DEFAULT_TECH_LIST_CONTROLS)
  }

  const handleTechListControlsChange = (nextControls) => {
    setTechListControls((current) => ({ ...current, ...nextControls }))
  }

  const statusCounts = useMemo(() => {
    if (!data) return null
    const active = (rows) => rows.filter((r) => r.current && r.status !== '삭제')
    return {
      strategicTech: active(data.strategic_tech).length,
      growthTech: active(data.growth_tech).length,
    }
  }, [data])

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-inner">
          <button
            type="button"
            className="app-title"
            onClick={() => goToCardView('strategic')}
          >조세특례제한법 첨단기술 현황판</button>
          {statusCounts && (
            <div className="header-stats">
              <button
                type="button"
                className="hstat"
                onClick={() => goToCardView('strategic')}
              >
                <span className="hstat-num hstat-num--strategic">{statusCounts.strategicTech}</span>
                <span className="hstat-label">국가전략기술</span>
              </button>
              <button
                type="button"
                className="hstat"
                onClick={() => goToCardView('growth')}
              >
                <span className="hstat-num hstat-num--growth">{statusCounts.growthTech}</span>
                <span className="hstat-label">신성장·원천기술</span>
              </button>
            </div>
          )}
        </div>
      </header>

      <div className="search-bar">
        <div className="search-bar-inner">
          <input
            className="global-search"
            type="search"
            placeholder="기술명 또는 기술 설명으로 검색…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {isSearching && (
            <button
              className="search-clear"
              onClick={() => setSearch('')}
              aria-label="검색 지우기"
            >×</button>
          )}
        </div>
      </div>

      <nav className="view-bar">
        <div className="view-toggle">
          <button
            className={`view-btn${view === 'card' ? ' active' : ''}`}
            onClick={() => setView('card')}
          >카드뷰</button>
          <button
            className={`view-btn${view === 'stats' ? ' active' : ''}`}
            onClick={() => setView('stats')}
          >통계</button>
        </div>

        {!isSearching && (view === 'stats' || (view === 'card' && !selectedSector)) && (
          <DatasetToggle filter={filter} onChange={setFilter} />
        )}
      </nav>

      <main className="main-content">
        {loading && <div className="loading">데이터 로딩 중…</div>}

        {!loading && isSearching && (
          <SearchResults data={data} query={search} onSelect={handleSearchSelect} />
        )}

        {!loading && !isSearching && view === 'card' && !selectedSector && (
          <SectorCards
            data={data}
            filter={filter}
            onSelect={handleSectorSelect}
          />
        )}

        {!loading && !isSearching && view === 'card' && selectedSector && !selectedTech && (
          <TechList
            data={data}
            sector={selectedSector}
            controls={techListControls}
            onControlsChange={handleTechListControlsChange}
            onBack={handleSectorBack}
            onSelect={(t) => setSelectedTech(t)}
            onRelatedSectorSelect={handleRelatedSectorSelect}
            onNavigateSector={handleSectorSelect}
          />
        )}

        {!loading && !isSearching && view === 'card' && selectedSector && selectedTech && (
          <TechDetail
            data={data}
            tech={selectedTech}
            sector={selectedSector}
            controls={techListControls}
            onBack={() => setSelectedTech(null)}
            onRelatedTechSelect={handleRelatedTechSelect}
            onNavigateTech={(t) => setSelectedTech(t)}
          />
        )}

        {!loading && !isSearching && view === 'stats' && <StatsView data={data} filter={filter} onFilter={setFilter} />}
      </main>

    </div>
  )
}
