import { useEffect, useMemo, useRef, useState } from 'react';
import {
	REWARDS,
	WEAPONS,
	emblemConflicts,
	emblemRarity,
	emblemTier,
	findEmblem,
	type InventoryState,
	type PvpRoomPayload,
	type PvpSnapshotPayload,
	type RewardDefinition,
	type SeededRun,
	type WeaponId,
} from '@tmd/shared';
import {
	ensureGuest,
	finishRemoteRun,
	startRemoteRun,
	verifyEmail,
	refreshIdentity,
	getProfile,
	getRanking,
	loginAccount,
	logoutAccount,
	registerAccount,
	requestPasswordReset,
	resetPassword,
	resendVerification,
	updateProfile,
	type Identity,
} from './api';
import { GameCanvas } from './game/GameCanvas';
import { PvpCanvas } from './game/PvpCanvas';
import type { GameEngine } from './game/GameEngine';
import type { GameResult, HudSnapshot } from './game/types';
import { PvpClient, type PvpStatus } from './PvpClient';
import { useMenuNavigation } from './useMenuNavigation';
import { ScreenTransition, useScreenTransition } from './ScreenTransition';
import { Icon, IconDefinitions } from './Icons';

type Screen =
	'loading' | 'menu' | 'weapons' | 'game' | 'rewards' | 'result' | 'profile' | 'ranking';
interface Settings {
	master: number;
	music: number;
	effects: number;
	uiScale: number;
	reduceFlashes: boolean;
	showRangeGuide: boolean;
}
const defaultSettings: Settings = {
	master: 0.8,
	music: 0.65,
	effects: 0.8,
	uiScale: 1,
	reduceFlashes: false,
	showRangeGuide: true,
};
const initialHud: HudSnapshot = {
	health: 100,
	maxHealth: 100,
	remainingMs: 600000,
	phase: 'active',
	roomName: 'Vestíbulo',
	roomIndex: 1,
	roomTotal: 7,
	objective: 'Encontre o guardião',
	weaponId: 'sword',
	cooldown: 0,
	enemies: 0,
};

export function App() {
	const [screen, setScreen] = useState<Screen>('loading'),
		[identity, setIdentity] = useState<Identity | null>(null),
		[weapon, setWeapon] = useState<WeaponId>('sword'),
		[dungeon, setDungeon] = useState<SeededRun | null>(null),
		[runId, setRunId] = useState(''),
		[hud, setHud] = useState(initialHud),
		[paused, setPaused] = useState(false),
		[settingsOpen, setSettingsOpen] = useState(false),
		[result, setResult] = useState<GameResult | null>(null),
		[settings, setSettings] = useState<Settings>(() => {
			try {
				return { ...defaultSettings, ...JSON.parse(localStorage.getItem('tmd.settings') ?? '{}') };
			} catch {
				return defaultSettings;
			}
		}),
		[rewards, setRewards] = useState<RewardDefinition[]>([]),
		[pvp, setPvp] = useState<{ open: boolean; status: PvpStatus; message: string }>({
			open: false,
			status: 'idle',
			message: '',
		}),
		[pvpSnapshot, setPvpSnapshot] = useState<PvpSnapshotPayload | null>(null),
		[pvpRoom, setPvpRoom] = useState<PvpRoomPayload | null>(null),
		[notice, setNotice] = useState(''),
		[pendingConflict, setPendingConflict] = useState<{
			reward: RewardDefinition;
			conflicts: string[];
		} | null>(null),
		[resetToken, setResetToken] = useState('');
	const [zoneIndex, setZoneIndex] = useState(0),
		[nextZoneBonus, setNextZoneBonus] = useState(0),
		[inventory, setInventory] = useState<InventoryState>({ capacity: 6, slots: [] }),
		[inventoryOpen, setInventoryOpen] = useState(false);
	const engine = useRef<GameEngine | null>(null),
		pvpClient = useRef<PvpClient | null>(null);
	const transition = useScreenTransition();
	useEffect(() => {
		const params = new URLSearchParams(location.search);
		const verify = params.get('verify');
		const reset = params.get('reset');
		if (reset) setResetToken(reset);
		(async () => {
			let current: Identity;
			try {
				current = verify ? await verifyEmail(verify) : await ensureGuest();
				if (verify) setNotice('E-mail confirmado. Sua conta já pode participar do ranking.');
			} catch {
				current = await ensureGuest();
				if (verify) setNotice('Este link de verificação expirou ou já foi utilizado.');
			}
			if (verify || reset) {
				history.replaceState(null, '', location.pathname);
			}
			setIdentity(current);
			setScreen('menu');
		})();
	}, []);
	useEffect(() => {
		localStorage.setItem('tmd.settings', JSON.stringify(settings));
		document.documentElement.style.setProperty('--ui-scale', String(settings.uiScale));
	}, [settings]);
	useEffect(() => {
		engine.current?.setCombatInputLocked(inventoryOpen);
	}, [inventoryOpen]);
	useMenuNavigation(
		screen !== 'game' || paused || settingsOpen || pvp.open,
		`${screen}:${paused}:${settingsOpen}:${pvp.open}`,
	);
	const go = (target: Screen) => transition.run(() => setScreen(target));
	const begin = async (id: WeaponId) => {
		if (!identity) return;
		setWeapon(id);
		const data = await startRemoteRun(identity, id);
		setRunId(data.runId);
		setDungeon(data.dungeon);
		setZoneIndex(0);
		setNextZoneBonus(0);
		setInventory({ capacity: 6, slots: [{ kind: 'potion', itemId: 'field-tonic', quantity: 1 }] });
		setHud({
			...initialHud,
			weaponId: id,
			roomTotal: data.dungeon.zones[0]?.rooms.length ?? data.dungeon.rooms.length,
		});
		setPaused(false);
		setResult(null);
		await transition.run(() => setScreen('game'));
	};
	const finish = async (gameResult: GameResult) => {
		if (result) return;
		setResult(gameResult);
		await transition.run(() => setScreen('result'));
		if (identity)
			await finishRemoteRun(identity, {
				runId,
				outcome: gameResult.outcome,
				elapsedMs: gameResult.elapsedMs,
				activePlayMs: gameResult.elapsedMs,
				roomsCleared: gameResult.roomsCleared,
				zonesCleared: zoneIndex,
				enemiesDefeated: gameResult.enemiesDefeated,
				guardiansDefeated: zoneIndex,
				acceptedRewardIds: inventory.slots.filter((s) => s.kind === 'emblem').map((s) => s.itemId),
			});
	};
	const showReward = () => {
		engine.current?.setPaused(true);
		const weaponRewards = REWARDS.filter((r) => {
			if (r.weaponId && r.weaponId !== weapon) return false;
			const slot = inventory.slots.find(
				(entry) => entry.kind === 'emblem' && entry.itemId === r.id,
			);
			return !slot || slot.quantity < 3;
		});
		const rng = (dungeon?.seed ?? 1) + zoneIndex;
		const time = weaponRewards.filter((r) => r.kind === 'time')[rng % 2]!;
		const specifics = weaponRewards.filter((r) => r.kind === 'weapon');
		const generals = weaponRewards.filter((r) => r.kind === 'general');
		setRewards(
			[
				time,
				specifics.length ? specifics[rng % specifics.length] : undefined,
				generals.length ? generals[rng % generals.length] : undefined,
			].filter((value): value is RewardDefinition => Boolean(value)),
		);
		void transition.run(() => setScreen('rewards'));
	};
	const addReward = (reward: RewardDefinition) => {
		if (reward.timeBonusSeconds) return true;
		const index = inventory.slots.findIndex(
			(s) => s.kind === 'emblem' && s.itemId === reward.id && s.quantity < 3,
		);
		if (index >= 0) {
			const slots = [...inventory.slots];
			const slot = slots[index]!;
			slots[index] = { ...slot, quantity: (slot.quantity + 1) as 2 | 3 };
			setInventory({ ...inventory, slots });
			return true;
		}
		if (inventory.slots.length >= inventory.capacity) return false;
		setInventory({
			...inventory,
			slots: [...inventory.slots, { kind: 'emblem', itemId: reward.id, quantity: 1 }],
		});
		return true;
	};
	const acceptReward = (reward: RewardDefinition, removeIds: string[] = []) => {
		if (removeIds.length) {
			const base = {
				...inventory,
				slots: inventory.slots.filter((slot) => !removeIds.includes(slot.itemId)),
			};
			if (!reward.timeBonusSeconds)
				setInventory({
					...base,
					slots: [...base.slots, { kind: 'emblem', itemId: reward.id, quantity: 1 }],
				});
		} else if (!addReward(reward)) {
			setNotice('Mochila cheia. Descarte um item antes de aceitar esta relíquia.');
			return;
		}
		const currentQuantity =
			inventory.slots.find((slot) => slot.kind === 'emblem' && slot.itemId === reward.id)
				?.quantity ?? 0;
		const emblem = findEmblem(reward.id);
		const emblemTime = emblem
			? (emblemTier(emblem, Math.min(3, currentQuantity + 1)).timeBonusSeconds ?? 0)
			: 0;
		setNextZoneBonus(Math.min(120, reward.timeBonusSeconds ?? emblemTime));
		setRewards([]);
		if (dungeon && zoneIndex < dungeon.zones.length - 1) {
			setZoneIndex((i) => i + 1);
			void transition.run(() => setScreen('game'));
		} else {
			void finish({
				outcome: 'guardian',
				elapsedMs: 600000 - hud.remainingMs,
				roomsCleared: hud.roomIndex,
				enemiesDefeated: 0,
			});
		}
	};
	const selectReward = (reward: RewardDefinition) => {
		const conflicts = emblemConflicts(inventory, reward.id).map((slot) => slot.itemId);
		if (conflicts.length) {
			setPendingConflict({ reward, conflicts });
			return;
		}
		acceptReward(reward);
	};
	const openPvp = () => {
		if (!identity) return;
		engine.current?.setPaused(false);
		setPvpSnapshot(null);
		setPvpRoom(null);
		const client = new PvpClient(
			identity,
			weapon,
			(status, message) => setPvp({ open: true, status, message }),
			setPvpSnapshot,
			setPvpRoom,
		);
		pvpClient.current = client;
		setPvp({ open: true, status: 'searching', message: 'Acendendo o círculo…' });
		client.connect();
	};
	const closePvp = () => {
		pvpClient.current?.leave();
		pvpClient.current = null;
		setPvpSnapshot(null);
		setPvpRoom(null);
		setPvp({ open: false, status: 'idle', message: '' });
	};
	const callbacks = useMemo(
		() => ({
			onHud: setHud,
			onPause: () => setPaused((p) => !p),
			onReward: showReward,
			onPvp: openPvp,
			onResult: (r: GameResult) => void finish(r),
			onRoomTransition: (swap: () => void) => transition.run(swap),
			onInventory: () => setInventoryOpen((v) => !v),
			onUsePotion: () => {
				const index = inventory.slots.findIndex((s) => s.kind === 'potion');
				if (index < 0) return false;
				setInventory((current) => ({
					...current,
					slots: current.slots.filter((_, i) => i !== index),
				}));
				return true;
			},
		}),
		[identity, weapon, runId, hud.remainingMs, hud.roomIndex, result, transition.run, inventory],
	);
	const activeDungeon = useMemo(
		() => (dungeon ? zoneRun(dungeon, zoneIndex) : null),
		[dungeon, zoneIndex],
	);
	if (screen === 'loading')
		return (
			<>
				<IconDefinitions />
				<Loading />
			</>
		);
	return (
		<main className={`app ${settings.reduceFlashes ? 'reduce-flashes' : ''}`}>
			<IconDefinitions />
			{screen === 'menu' && (
				<Menu
					onPlay={() => void go('weapons')}
					onRanking={() => void go('ranking')}
					onProfile={() => void go('profile')}
					onSettings={() => setSettingsOpen(true)}
				/>
			)}
			{screen === 'weapons' && (
				<WeaponSelect onSelect={(id) => void begin(id)} onBack={() => void go('menu')} />
			)}
			{screen === 'game' && activeDungeon && (
				<div className="game-shell">
					<Hud hud={hud} />
					<GameCanvas
						weaponId={weapon}
						dungeon={activeDungeon}
						callbacks={callbacks}
						paused={paused}
						timerSeconds={600 + nextZoneBonus}
						reduceFlashes={settings.reduceFlashes}
						showRangeGuide={settings.showRangeGuide}
						zoneIndex={zoneIndex}
						emblemIds={inventory.slots
							.filter((s) => s.kind === 'emblem')
							.flatMap((s) => Array(s.quantity).fill(s.itemId) as string[])}
						onEngine={(e) => (engine.current = e)}
					/>
					<ControlHint />
					{hud.phase === 'collapse' && (
						<div className="collapse-warning">COLAPSO — ENCONTRE A SAÍDA</div>
					)}
					{inventoryOpen && (
						<InventoryPanel
							inventory={inventory}
							onDiscard={(index) =>
								setInventory({ ...inventory, slots: inventory.slots.filter((_, i) => i !== index) })
							}
							onClose={() => setInventoryOpen(false)}
						/>
					)}{' '}
					{paused && (
						<PauseMenu
							onContinue={() => {
								setPaused(false);
								engine.current?.setPaused(false);
							}}
							onSettings={() => setSettingsOpen(true)}
							onQuit={() => void go('menu')}
						/>
					)}
				</div>
			)}
			{screen === 'rewards' && (
				<RewardScreen rewards={rewards} inventory={inventory} onSelect={selectReward} />
			)}
			{screen === 'result' && result && (
				<ResultScreen
					result={result}
					onAgain={() => void go('weapons')}
					onMenu={() => void go('menu')}
				/>
			)}
			{screen === 'profile' && (
				<Profile
					identity={identity!}
					resetToken={resetToken}
					onIdentity={setIdentity}
					onBack={() => void go('menu')}
				/>
			)}
			{screen === 'ranking' && (
				<Ranking
					identity={identity!}
					onBack={() => void go('menu')}
					onProfile={() => void go('profile')}
				/>
			)}
			{notice && (
				<div className="app-notice" role="status">
					{notice}
					<button onClick={() => setNotice('')} aria-label="Fechar aviso">
						×
					</button>
				</div>
			)}
			{settingsOpen && (
				<SettingsModal
					value={settings}
					onChange={setSettings}
					onClose={() => setSettingsOpen(false)}
				/>
			)}
			{pendingConflict && (
				<div className="overlay conflict-backdrop" role="presentation">
					<section
						className="modal conflict-modal"
						role="dialog"
						aria-modal="true"
						aria-labelledby="conflict-title"
					>
						<span className="eyebrow">EMBLEMAS CONTRAPONTOS</span>
						<h2 id="conflict-title">Substituir a transformação atual?</h2>
						<p>
							<b>{pendingConflict.reward.name}</b> é incompatível com{' '}
							{pendingConflict.conflicts.map((id) => findEmblem(id)?.name ?? id).join(', ')}.
						</p>
						<button
							className="primary"
							autoFocus
							onClick={() => {
								const pending = pendingConflict;
								setPendingConflict(null);
								acceptReward(pending.reward, pending.conflicts);
							}}
						>
							Substituir emblema
						</button>
						<button onClick={() => setPendingConflict(null)}>Manter o atual</button>
					</section>
				</div>
			)}
			{pvp.open && (
				<PvpModal
					status={pvp.status}
					message={pvp.message}
					snapshot={pvpSnapshot}
					roomData={pvpRoom}
					ownSessionId={identity?.sessionId ?? ''}
					client={pvpClient.current}
					onClose={closePvp}
				/>
			)}
			<ScreenTransition phase={transition.phase} />
		</main>
	);
}

function zoneRun(run: SeededRun, index: number): SeededRun {
	const zone = run.zones[index] ?? run.zones[0];
	return zone ? { ...run, graph: zone.graph, rooms: zone.rooms, zones: [zone] } : run;
}
function InventoryPanel({
	inventory,
	onDiscard,
	onClose,
}: {
	inventory: InventoryState;
	onDiscard: (index: number) => void;
	onClose: () => void;
}) {
	return (
		<div className="inventory-overlay">
			<section className="inventory-panel">
				<span className="eyebrow">MOCHILA EM RISCO</span>
				<h2>Inventário</h2>
				<p>O combate continua. Emblemas iguais acumulam até três.</p>
				<div className="inventory-grid">
					{Array.from({ length: inventory.capacity }, (_, i) => {
						const slot = inventory.slots[i];
						return slot ? (
							<button className="inventory-slot" key={i} onClick={() => onDiscard(i)}>
								<Icon name={slot.kind === 'potion' ? 'potion' : 'emblem'} />
								<b>{slot.itemId}</b>
								<small>
									{' '}
									×{slot.quantity}
									<br />
									clique para descartar
								</small>
							</button>
						) : (
							<div className="inventory-slot empty" key={i}>
								Vazio
							</div>
						);
					})}
				</div>
				<button onClick={onClose}>Fechar</button>
			</section>
		</div>
	);
}

function Loading() {
	return (
		<div className="center-screen">
			<Icon name="hourglass" className="hourglass" />
			<p>Calibrando o mecanismo…</p>
		</div>
	);
}
function Brand() {
	return (
		<div className="brand">
			<h1>
				<span>Ten Minutes</span>
				<strong>Dungeon</strong>
			</h1>
			<p>Desça. Escolha. Escape. Ou não.</p>
		</div>
	);
}
function Menu({
	onPlay,
	onRanking,
	onProfile,
	onSettings,
}: {
	onPlay: () => void;
	onRanking: () => void;
	onProfile: () => void;
	onSettings: () => void;
}) {
	return (
		<div className="menu-screen">
			<section className="menu-panel">
				<Brand />
				<nav className="menu-actions" aria-label="Menu principal">
					<button className="primary" onClick={onPlay}>
						<span>Iniciar descida</span>
					</button>
					<button onClick={onRanking}>
						<span>Ranking</span>
					</button>
					<button onClick={onProfile}>
						<span>Perfil do errante</span>
					</button>
					<button onClick={onSettings}>
						<span>Configurações</span>
					</button>
				</nav>
				<div className="menu-hint">
					<kbd>W</kbd>
					<kbd>S</kbd>
					<span>Selecionar</span>
					<kbd>↵</kbd>
					<span>Confirmar</span>
				</div>
			</section>
		</div>
	);
}
function WeaponSelect({
	onSelect,
	onBack,
}: {
	onSelect: (id: WeaponId) => void;
	onBack: () => void;
}) {
	return (
		<div className="selection-screen">
			<header>
				<button className="ghost" onClick={onBack}>
					← Voltar
				</button>
				<div>
					<span className="eyebrow">RITO DE ENTRADA</span>
					<h2>Escolha seu instrumento</h2>
					<p>A arma decide o ritmo da descida. Não há troca durante esta run.</p>
				</div>
			</header>
			<div className="weapon-grid">
				{Object.values(WEAPONS).map((w) => (
					<button className="weapon-card" key={w.id} onClick={() => onSelect(w.id)}>
						<WeaponIcon id={w.id} />
						<div>
							<h3>{w.name}</h3>
							<p>{w.description}</p>
						</div>
						<dl>
							<div>
								<dt>Dano</dt>
								<dd>{w.damage}</dd>
							</div>
							<div>
								<dt>Crítico</dt>
								<dd>{Math.round(w.critChance * 100)}%</dd>
							</div>
							<div>
								<dt>Ritmo</dt>
								<dd>{w.cooldownMs < 400 ? 'Rápido' : w.cooldownMs < 600 ? 'Médio' : 'Lento'}</dd>
							</div>
						</dl>
						<span className="choose">Escolher →</span>
					</button>
				))}
			</div>
		</div>
	);
}
function WeaponIcon({ id }: { id: WeaponId }) {
	return (
		<div className={`weapon-icon ${id}`} aria-hidden="true">
			<span />
		</div>
	);
}
function Hud({ hud }: { hud: HudSnapshot }) {
	const totalSeconds = Math.ceil(hud.remainingMs / 1000),
		time = `${String(Math.floor(totalSeconds / 60)).padStart(2, '0')}:${String(totalSeconds % 60).padStart(2, '0')}`;
	return (
		<>
			<header className="hud">
				<div className="health-block">
					<span>VITALIDADE</span>
					<div className="health-bar">
						<i style={{ width: `${(hud.health / hud.maxHealth) * 100}%` }} />
					</div>
					<b>
						{hud.health}/{hud.maxHealth}
					</b>
				</div>
				<div className="objective">
					<span>
						{hud.roomName} • {hud.roomIndex}/{hud.roomTotal}
					</span>
					<strong>{hud.objective}</strong>
				</div>
				<div className={`timer ${hud.phase === 'collapse' ? 'danger' : ''}`}>
					<small>{hud.phase === 'collapse' ? 'COLAPSO' : 'TEMPO DA ZONA'}</small>
					<b>{time}</b>
				</div>
			</header>
			{hud.boss && (
				<div className={`boss-hud ${hud.boss.cinematic ? 'collapsing' : ''}`}>
					<span>{hud.boss.name}</span>
					<div className="boss-health">
						<i style={{ width: `${Math.max(0, (hud.boss.health / hud.boss.maxHealth) * 100)}%` }} />
					</div>
					<small>
						{Math.ceil(hud.boss.health)} / {hud.boss.maxHealth}
						{hud.boss.cinematic ? ' · COLAPSO' : ''}
					</small>
				</div>
			)}
		</>
	);
}
function ControlHint() {
	return (
		<div className="control-hint">
			<span>
				<kbd>WASD</kbd> mover
			</span>
			<span>
				<kbd>MOUSE</kbd> mirar
			</span>
			<span>
				<kbd>CLIQUE</kbd> atacar
			</span>
			<span>
				<kbd>E</kbd> interagir
			</span>
		</div>
	);
}
function PauseMenu({
	onContinue,
	onSettings,
	onQuit,
}: {
	onContinue: () => void;
	onSettings: () => void;
	onQuit: () => void;
}) {
	return (
		<div className="overlay">
			<section className="modal pause persona-menu" data-navigation="linear">
				<span className="eyebrow">MECANISMO SUSPENSO</span>
				<h2>Pausado</h2>
				<p>A cripta aguarda. O tempo também.</p>
				<button className="primary" onClick={onContinue}>
					<span>Continuar</span>
				</button>
				<button onClick={onSettings}>
					<span>Configurações</span>
				</button>
				<button onClick={onQuit}>
					<span>Voltar ao menu</span>
				</button>
				<div className="menu-hint">
					<kbd>W</kbd>
					<kbd>S</kbd>
					<span>Navegar</span>
					<kbd>↵</kbd>
					<span>Confirmar</span>
				</div>
			</section>
		</div>
	);
}
function RewardScreen({
	rewards,
	inventory,
	onSelect,
}: {
	rewards: RewardDefinition[];
	inventory: InventoryState;
	onSelect: (r: RewardDefinition) => void;
}) {
	return (
		<div className="reward-screen">
			<header>
				<span className="eyebrow">O CRONARCA CAIU</span>
				<h2>Uma escolha atravessa a próxima porta</h2>
				<p>Escolha uma relíquia. As demais serão consumidas pelo mecanismo.</p>
			</header>
			<div className="reward-grid">
				{rewards.map((r) => (
					<button
						key={r.id}
						className="reward-card"
						onClick={() => onSelect(r)}
						data-icon={r.iconName ?? r.kind}
					>
						<div className="relic">
							<Icon name={r.kind === 'time' ? 'time' : r.kind === 'weapon' ? 'weapon' : 'emblem'} />
						</div>
						<h3>{r.name}</h3>
						{r.kind !== 'time' &&
							(() => {
								const current =
									inventory.slots.find((slot) => slot.kind === 'emblem' && slot.itemId === r.id)
										?.quantity ?? 0;
								const next = Math.min(3, current + 1);
								return (
									<span className={`rarity rarity-${emblemRarity(next)}`}>
										{emblemRarity(next)} · nível {next}/3
									</span>
								);
							})()}
						<p>{r.description}</p>
						<span className="choose">Aceitar relíquia →</span>
					</button>
				))}
			</div>
		</div>
	);
}
function ResultScreen({
	result,
	onAgain,
	onMenu,
}: {
	result: GameResult;
	onAgain: () => void;
	onMenu: () => void;
}) {
	const won = result.outcome === 'guardian' || result.outcome === 'escaped';
	return (
		<div className="center-screen result persona-menu">
			<span className="eyebrow">REGISTRO DA AMPULHETA</span>
			<h2>{won ? 'Zona conquistada' : 'A cripta o reclamou'}</h2>
			<div className="result-stats">
				<div>
					<b>{result.roomsCleared}</b>
					<span>salas vistas</span>
				</div>
				<div>
					<b>{result.enemiesDefeated}</b>
					<span>inimigos vencidos</span>
				</div>
				<div>
					<b>{Math.floor(result.elapsedMs / 1000)}s</b>
					<span>tempo transcorrido</span>
				</div>
			</div>
			<button className="primary" onClick={onAgain}>
				<span>Nova descida</span>
			</button>
			<button onClick={onMenu}>
				<span>Menu principal</span>
			</button>
		</div>
	);
}
function Profile({
	identity,
	resetToken,
	onIdentity,
	onBack,
}: {
	identity: Identity;
	resetToken: string;
	onIdentity: (identity: Identity) => void;
	onBack: () => void;
}) {
	const [profile, setProfile] = useState<Awaited<ReturnType<typeof getProfile>> | null>(null),
		[mode, setMode] = useState<'view' | 'register' | 'login' | 'reset'>(
			resetToken ? 'reset' : 'view',
		),
		[busy, setBusy] = useState(false),
		[message, setMessage] = useState(''),
		[mergeGuest, setMergeGuest] = useState(!identity.player.accountEmail);
	const [name, setName] = useState(identity.player.displayName),
		[email, setEmail] = useState(identity.player.accountEmail ?? ''),
		[password, setPassword] = useState(''),
		[countryCode, setCountryCode] = useState(identity.player.countryCode ?? 'BR'),
		[regionCode, setRegionCode] = useState(identity.player.regionCode ?? ''),
		[resetPasswordValue, setResetPasswordValue] = useState('');
	useEffect(() => {
		getProfile(identity)
			.then((value) => {
				setProfile(value);
				setName(value.player.displayName);
				setEmail(value.player.accountEmail ?? '');
				setCountryCode(value.player.countryCode ?? 'BR');
				setRegionCode(value.player.regionCode ?? '');
			})
			.catch(() => setMessage('Não foi possível carregar o perfil agora.'));
	}, [identity.player.id]);
	const submit = async (action: () => Promise<unknown>, success: string) => {
		setBusy(true);
		setMessage('');
		try {
			await action();
			setMessage(success);
		} catch (error) {
			setMessage(error instanceof Error ? error.message : 'A ação não foi concluída.');
		} finally {
			setBusy(false);
		}
	};
	const saveProfile = () =>
		submit(async () => {
			await updateProfile({
				displayName: name,
				countryCode: countryCode.toUpperCase(),
				regionCode,
			});
			const current = await refreshIdentity();
			onIdentity(current);
			setProfile(await getProfile(current));
		}, 'Perfil atualizado. Alterações de região no ranking entram em vigor na próxima semana.');
	const signOut = () =>
		submit(async () => {
			await logoutAccount();
			onIdentity(await ensureGuest());
			setProfile(null);
			setMode('view');
		}, 'Sessão encerrada.');
	return (
		<div className="account-screen">
			<section className="account-panel profile persona-menu">
				<span className="eyebrow">REGISTRO DO ERRANTE</span>
				<h2>{identity.player.displayName}</h2>
				{message && (
					<p className="form-message" role="status">
						{message}
					</p>
				)}
				{mode === 'view' && (
					<>
						<div className="profile-overview">
							<div className="seal">{identity.player.displayName.slice(0, 1).toUpperCase()}</div>
							<div>
								<b>{identity.player.accountEmail ?? 'Convidado local'}</b>
								<small>
									{identity.player.emailVerified
										? 'E-mail confirmado'
										: identity.player.accountEmail
											? 'Confirmação pendente'
											: 'Progresso nesta sessão'}
								</small>
							</div>
						</div>
						{identity.player.accountEmail && !identity.player.emailVerified && (
							<button
								onClick={() =>
									void submit(
										resendVerification,
										'Enviamos outro link de confirmação, se o servidor de e-mail estiver configurado.',
									)
								}
							>
								Reenviar confirmação
							</button>
						)}
						<form
							className="account-form"
							onSubmit={(e) => {
								e.preventDefault();
								void saveProfile();
							}}
						>
							<label>
								Nome público
								<input
									value={name}
									minLength={2}
									maxLength={24}
									onChange={(e) => setName(e.target.value)}
									required
								/>
							</label>
							<div className="region-fields">
								<label>
									País (ISO)
									<input
										value={countryCode}
										maxLength={2}
										onChange={(e) => setCountryCode(e.target.value)}
										required
									/>
								</label>
								<label>
									Estado / região
									<input
										value={regionCode}
										maxLength={12}
										onChange={(e) => setRegionCode(e.target.value)}
										placeholder="Ex.: SP"
										required
									/>
								</label>
							</div>
							<button className="primary" disabled={busy}>
								<span>Salvar perfil</span>
							</button>
						</form>
						{profile && (
							<div className="profile-stats">
								<div>
									<b>{profile.stats.bestScore.toLocaleString('pt-BR')}</b>
									<small>melhor pontuação</small>
								</div>
								<div>
									<b>{profile.stats.bestRooms}</b>
									<small>salas alcançadas</small>
								</div>
								<div>
									<b>{profile.stats.guardiansDefeated}</b>
									<small>guardiões vencidos</small>
								</div>
								<div>
									<b>
										{Math.floor(profile.stats.totalActivePlayMs / 3600000)}h{' '}
										{Math.floor(profile.stats.totalActivePlayMs / 60000) % 60}m
									</b>
									<small>tempo ativo</small>
								</div>
							</div>
						)}
						<h3>Últimas descidas</h3>
						<div className="history-list">
							{profile?.history.length ? (
								profile.history.map((run) => (
									<div key={run.id}>
										<span>
											{run.outcome ?? 'Em andamento'} ·{' '}
											{new Date(run.createdAt).toLocaleDateString('pt-BR')}
										</span>
										<b>
											{run.score.toLocaleString('pt-BR')} pts · {run.roomsCleared} salas
										</b>
									</div>
								))
							) : (
								<p>Seu histórico aparecerá depois da primeira descida concluída.</p>
							)}
						</div>
						<h3>Emblemas descobertos</h3>
						<p>
							{profile?.discoveredEmblems.length
								? profile.discoveredEmblems.join(' · ')
								: 'Nenhum emblema descoberto ainda.'}
						</p>
						{identity.player.accountEmail ? (
							<button onClick={() => void signOut()}>Sair da conta</button>
						) : (
							<div className="account-actions">
								<button
									onClick={() => {
										setMode('register');
										setMessage('');
									}}
								>
									Criar conta e preservar progresso
								</button>
								<button
									onClick={() => {
										setMode('login');
										setMessage('');
									}}
								>
									Entrar em uma conta
								</button>
							</div>
						)}
					</>
				)}
				{mode === 'register' && (
					<form
						className="account-form"
						onSubmit={(e) => {
							e.preventDefault();
							void submit(async () => {
								await registerAccount({
									displayName: name,
									email,
									password,
									countryCode: countryCode.toUpperCase(),
									regionCode,
								});
								const current = await refreshIdentity();
								onIdentity(current);
								setProfile(await getProfile(current));
								setMode('view');
							}, 'Conta criada. Confira seu e-mail para confirmar o endereço.');
						}}
					>
						<label>
							Nome público
							<input
								value={name}
								minLength={2}
								maxLength={24}
								onChange={(e) => setName(e.target.value)}
								required
							/>
						</label>
						<label>
							E-mail
							<input
								type="email"
								value={email}
								onChange={(e) => setEmail(e.target.value)}
								required
							/>
						</label>
						<label>
							Senha
							<input
								type="password"
								minLength={10}
								maxLength={128}
								value={password}
								onChange={(e) => setPassword(e.target.value)}
								autoComplete="new-password"
								required
							/>
						</label>
						<div className="region-fields">
							<label>
								País (ISO)
								<input
									value={countryCode}
									maxLength={2}
									onChange={(e) => setCountryCode(e.target.value)}
									required
								/>
							</label>
							<label>
								Estado / região
								<input
									value={regionCode}
									maxLength={12}
									onChange={(e) => setRegionCode(e.target.value)}
									required
								/>
							</label>
						</div>
						<p>
							Seu progresso de convidado ficará associado a esta conta. O ranking é liberado após
							confirmação de e-mail.
						</p>
						<button className="primary" disabled={busy}>
							<span>Criar conta</span>
						</button>
						<button type="button" onClick={() => setMode('view')}>
							Cancelar
						</button>
					</form>
				)}
				{mode === 'login' && (
					<form
						className="account-form"
						onSubmit={(e) => {
							e.preventDefault();
							void submit(async () => {
								const next = await loginAccount(email, password, mergeGuest);
								onIdentity(next);
								setProfile(await getProfile(next));
								setMode('view');
							}, 'Sessão iniciada.');
						}}
					>
						<label>
							E-mail
							<input
								type="email"
								value={email}
								onChange={(e) => setEmail(e.target.value)}
								required
							/>
						</label>
						<label>
							Senha
							<input
								type="password"
								value={password}
								onChange={(e) => setPassword(e.target.value)}
								autoComplete="current-password"
								required
							/>
						</label>
						{!identity.player.accountEmail && (
							<label className="checkbox-line">
								<input
									type="checkbox"
									checked={mergeGuest}
									onChange={(e) => setMergeGuest(e.target.checked)}
								/>{' '}
								Mesclar meu progresso de convidado
							</label>
						)}
						<button className="primary" disabled={busy}>
							<span>Entrar</span>
						</button>
						<button type="button" onClick={() => setMode('reset')}>
							Esqueci a senha
						</button>
						<button type="button" onClick={() => setMode('view')}>
							Cancelar
						</button>
					</form>
				)}
				{mode === 'reset' && (
					<form
						className="account-form"
						onSubmit={(e) => {
							e.preventDefault();
							void submit(
								() =>
									resetToken
										? resetPassword(resetToken, resetPasswordValue)
										: requestPasswordReset(email),
								resetToken
									? 'Senha alterada. Entre com a nova senha.'
									: 'Se a conta existir, enviaremos um link de recuperação.',
							);
						}}
					>
						{resetToken ? (
							<label>
								Nova senha
								<input
									type="password"
									minLength={10}
									maxLength={128}
									value={resetPasswordValue}
									onChange={(e) => setResetPasswordValue(e.target.value)}
									required
								/>
							</label>
						) : (
							<label>
								E-mail da conta
								<input
									type="email"
									value={email}
									onChange={(e) => setEmail(e.target.value)}
									required
								/>
							</label>
						)}
						<button className="primary" disabled={busy}>
							<span>{resetToken ? 'Salvar nova senha' : 'Enviar link'}</span>
						</button>
						<button type="button" onClick={() => setMode('login')}>
							Voltar
						</button>
					</form>
				)}
				<button className="back-button" onClick={onBack}>
					<span>← Voltar ao menu</span>
				</button>
			</section>
		</div>
	);
}
function Ranking({
	identity,
	onBack,
	onProfile,
}: {
	identity: Identity;
	onBack: () => void;
	onProfile: () => void;
}) {
	const [scope, setScope] = useState<'national' | 'regional'>('national'),
		[entries, setEntries] = useState<Awaited<ReturnType<typeof getRanking>>['entries']>([]),
		[loading, setLoading] = useState(true),
		[error, setError] = useState('');
	useEffect(() => {
		setLoading(true);
		setError('');
		getRanking(scope)
			.then((data) => setEntries(data.entries))
			.catch((e) => setError((e as Error).message))
			.finally(() => setLoading(false));
	}, [scope, identity.player.id]);
	return (
		<div className="account-screen">
			<section className="account-panel ranking-panel">
				<span className="eyebrow">MELHORES DESCIDAS VERIFICADAS</span>
				<h2>Ranking</h2>
				<div className="ranking-tabs">
					<button
						className={scope === 'national' ? 'primary' : ''}
						onClick={() => setScope('national')}
					>
						Nacional
					</button>
					<button
						className={scope === 'regional' ? 'primary' : ''}
						onClick={() => setScope('regional')}
					>
						Regional
					</button>
				</div>
				{loading ? (
					<p>Consultando os registros…</p>
				) : error === 'REGION_REQUIRED' ? (
					<div className="empty-state">
						<p>Defina país e estado no perfil para consultar sua região e aparecer no ranking.</p>
						<button onClick={onProfile}>Completar perfil</button>
					</div>
				) : error ? (
					<p className="form-message">Ranking indisponível: {error}</p>
				) : entries.length ? (
					<div className="ranking-list">
						{entries.map((entry) => (
							<article
								key={entry.playerId}
								className={entry.playerId === identity.player.id ? 'self' : ''}
							>
								<b className="rank-number">{String(entry.rank).padStart(2, '0')}</b>
								<div>
									<strong>
										{entry.displayName}
										{entry.playerId === identity.player.id ? ' · você' : ''}
									</strong>
									<small>
										{entry.roomsCleared} salas · {entry.guardiansDefeated} guardiões ·{' '}
										{Math.floor(entry.activePlayMs / 60000)} min ativos
									</small>
								</div>
								<b className="rank-score">{entry.score.toLocaleString('pt-BR')}</b>
							</article>
						))}
					</div>
				) : (
					<p className="empty-state">Ainda não há runs verificadas neste recorte.</p>
				)}
				<button className="back-button" onClick={onBack}>
					<span>← Voltar ao menu</span>
				</button>
			</section>
		</div>
	);
}
function SettingsModal({
	value,
	onChange,
	onClose,
}: {
	value: Settings;
	onChange: (s: Settings) => void;
	onClose: () => void;
}) {
	const patch = (p: Partial<Settings>) => onChange({ ...value, ...p });
	return (
		<div className="overlay">
			<section className="modal settings persona-menu" data-navigation="linear">
				<span className="eyebrow">CALIBRAÇÃO</span>
				<h2>Configurações</h2>
				<label>
					Volume geral{' '}
					<input
						type="range"
						min="0"
						max="1"
						step=".05"
						value={value.master}
						onChange={(e) => patch({ master: +e.target.value })}
					/>
				</label>
				<label>
					Música{' '}
					<input
						type="range"
						min="0"
						max="1"
						step=".05"
						value={value.music}
						onChange={(e) => patch({ music: +e.target.value })}
					/>
				</label>
				<label>
					Efeitos{' '}
					<input
						type="range"
						min="0"
						max="1"
						step=".05"
						value={value.effects}
						onChange={(e) => patch({ effects: +e.target.value })}
					/>
				</label>
				<label>
					Escala da interface{' '}
					<select value={value.uiScale} onChange={(e) => patch({ uiScale: +e.target.value })}>
						<option value=".9">90%</option>
						<option value="1">100%</option>
						<option value="1.1">110%</option>
					</select>
				</label>
				<label className="flash-option">
					<input
						type="checkbox"
						checked={value.reduceFlashes}
						onChange={(e) => patch({ reduceFlashes: e.target.checked })}
					/>{' '}
					Reduzir flashes visuais
				</label>
				<label className="flash-option">
					<input
						type="checkbox"
						checked={value.showRangeGuide}
						onChange={(e) => patch({ showRangeGuide: e.target.checked })}
					/>{' '}
					Mostrar alcance da bacamarte
				</label>
				<button className="primary" onClick={onClose}>
					<span>Concluir</span>
				</button>
			</section>
		</div>
	);
}
function PvpModal({
	status,
	message,
	snapshot,
	roomData,
	ownSessionId,
	client,
	onClose,
}: {
	status: PvpStatus;
	message: string;
	snapshot: PvpSnapshotPayload | null;
	roomData: PvpRoomPayload | null;
	ownSessionId: string;
	client: PvpClient | null;
	onClose: () => void;
}) {
	const keys = useRef(new Set<string>()),
		aim = useRef({ x: 1, y: 0 }),
		mouseDown = useRef(false);
	const players = snapshot?.players ?? [];
	const aimAt = (x: number, y: number) => {
		const self = players.find((p) => p.sessionId === ownSessionId);
		if (!self) return;
		const dx = x - self.x,
			dy = y - self.y,
			d = Math.hypot(dx, dy) || 1;
		aim.current = { x: dx / d, y: dy / d };
	};
	useEffect(() => {
		if (status !== 'matched' || !client) return;
		const down = (e: KeyboardEvent) => {
				keys.current.add(e.code);
				if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code))
					e.preventDefault();
			},
			up = (e: KeyboardEvent) => keys.current.delete(e.code);
		window.addEventListener('keydown', down);
		window.addEventListener('keyup', up);
		const timer = window.setInterval(() => {
			client.sendInput({
				moveX:
					Number(keys.current.has('KeyD') || keys.current.has('ArrowRight')) -
					Number(keys.current.has('KeyA') || keys.current.has('ArrowLeft')),
				moveY:
					Number(keys.current.has('KeyS') || keys.current.has('ArrowDown')) -
					Number(keys.current.has('KeyW') || keys.current.has('ArrowUp')),
				aimX: aim.current.x,
				aimY: aim.current.y,
				attack: keys.current.has('Space') || keys.current.has('Enter') || mouseDown.current,
			});
		}, 50);
		return () => {
			window.removeEventListener('keydown', down);
			window.removeEventListener('keyup', up);
			clearInterval(timer);
		};
	}, [status, client, ownSessionId]);
	return (
		<div className="overlay pvp-overlay">
			<section className={`modal pvp ${status === 'matched' ? 'pvp-room-modal' : ''}`}>
				<div className="pvp-topline">
					<span className="eyebrow">CÍRCULO DE DUELO · SALA COMPARTILHADA</span>
					{status === 'matched' && <span>WASD mover · mouse mirar · clique/Espaço atacar</span>}
				</div>
				<h2>
					{status === 'searching'
						? 'Buscando oponente'
						: status === 'matched'
							? 'Duelo em curso'
							: status === 'won'
								? 'Vitória'
								: status === 'lost'
									? 'Derrota'
									: 'Círculo indisponível'}
				</h2>
				{status === 'matched' && roomData ? (
					<div
						className="pvp-room-stage"
						onPointerDown={() => {
							mouseDown.current = true;
						}}
						onPointerUp={() => {
							mouseDown.current = false;
						}}
						onPointerLeave={() => {
							mouseDown.current = false;
						}}
					>
						<PvpCanvas
							roomData={roomData}
							snapshot={snapshot}
							ownSessionId={ownSessionId}
							onAim={aimAt}
						/>
					</div>
				) : (
					<div className={`duel-sigil ${status}`} />
				)}
				<p>{message}</p>
				<small>
					{status === 'matched' ? 'A luta ocupa a sala inteira. ' : ''}O timer da zona continua
					correndo. Abandonar conta como derrota.
				</small>
				<button onClick={onClose}>
					{status === 'searching' || status === 'matched'
						? 'Abandonar duelo'
						: 'Retornar à dungeon'}
				</button>
			</section>
		</div>
	);
}
