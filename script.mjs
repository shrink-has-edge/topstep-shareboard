let elements = get_elements()

let board_filename = get_board_filename()
let board = await fetch_board(board_filename)

/** @type {symbol_map} */
let symbol_map = {
	'F.US.EP': {
		'mapTo': 'es'
	},
	'F.US.MES': {
		'mapTo': 'es',
		'multiplier': 0.1
	},
	'F.US.ENQ': {
		'mapTo': 'nq'
	},
	'F.US.MNQ': {
		'mapTo': 'nq',
		'multiplier': 0.1
	},
	'F.US.GCE': {
		'mapTo': 'gc'
	},
	'F.US.MGC': {
		'mapTo': 'gc',
		'multiplier': 0.1
	},
	'F.US.CLE': {
		'mapTo': 'cl'
	},
	'F.US.MCL': {
		'mapTo': 'cl',
		'multiplier': 0.1
	}
}

let trades = await fetch_trades(board, symbol_map)
let stats = calculate_stats(trades)

let stats_grid = create_stats_grid(elements.stats, stats, board)
let trades_grid = create_trades_grid(elements.trades, trades)

let symbols = populate_symbols(elements.symbol, symbol_map)
if (localStorage.symbol)
	symbols.value = localStorage.symbol

let quotes = await fetch_quotes(symbols.value)
let chart = create_chart(elements.chart, quotes, trades, symbols.value)

symbols.addEventListener('change', async function (event) {
	localStorage.symbol = symbols.value

	quotes = await fetch_quotes(symbols.value)

	chart.dispose()
	chart = create_chart(elements.chart, quotes, trades, symbols.value)
})

window.addEventListener('resize', function () {chart.resize()})

populate_random_quote(elements.quote)

function get_elements () {
	let ids = ['stats', 'symbol', 'chart', 'trades', 'quote']

	/** @type {{[id: string]: HTMLElement}} */
	let elements = {}

	for (let id of ids) {
		let element = document.getElementById(id)
		if (!element)
			continue

		elements[id] = element
	}

	return elements
}

function get_board_filename () {
	let base_path = './boards/'
	let filename_chunk = 'default'

	let params = window.location.search.slice(1)
	if (params)
		filename_chunk = params

	let board_filename = `${base_path}${filename_chunk}.json`

	return board_filename
}

async function fetch_board (/** @type {string} */ board_filename) {
	let response = await fetch(board_filename)
	let response_object = await response.json()

	let start_date = new Date(response_object.start_date)
	let end_date = new Date(response_object.end_date)

	/** @type {board} */
	let board = {
		name: response_object.name,
		allow_practice: response_object.allow_practice,
		allow_combine: response_object.allow_combine,
		allow_xfa: response_object.allow_xfa,
		allow_multiple: response_object.allow_multiple,
		start_date: start_date,
		end_date: end_date,
		shares: response_object.shares,
	}

	return board
}

async function fetch_trades (/** @type {board} */ board, /** @type {symbol_map} */ symbol_map) {
	const topstepUrl = 'https://userapi.topstepx.com/Trade/range'
	const tradifyUrl = 'https://userapi.tradeify.projectx.com/Trade/range'

	/** @type {trades} */
	let trades = {}

	for (let user in board.shares) {
		if (!trades[user])
			trades[user] = []

		let shares = board.shares[user]

		for (let share of shares) {
			let url = topstepUrl
			let share_id = share.account_id

			if (share.platform == "tradeify") {
				url = tradifyUrl
			}

			let payload = {
				tradingAccountId: share_id,
				start: board.start_date.toISOString(),
				end: board.end_date.toISOString(),
			}

			if (share.start_date) {
				payload.start = new Date(share.start_date).toISOString()
			}if (share.end_date) {
				payload.end = new Date(share.end_date).toISOString()
			}

			let response_array
			try {
				let response = await fetch(url, {method: 'post', headers: {'content-type': 'application/json'}, body: JSON.stringify(payload)})
				response_array = await response.json()
			} catch (error) {
				console.error('fetch_data:', user, share_id)
				continue
			}

			for (let response_trade of response_array) {
				let symbolMap = symbol_map[response_trade.symbolId]
				let symbol = symbolMap ? symbolMap.mapTo : response_trade.symbolId
				if (!symbol) {
					console.error('symbol:', response_trade.symbolId)
					symbol = response_trade.symbolId
				}

				let start_date = new Date(response_trade.createdAt)
				if (start_date < board.start_date)
					continue

				let end_date = new Date(response_trade.exitedAt)
				if (end_date > board.end_date)
					continue

				let position = -response_trade.positionSize * ((symbolMap && symbolMap.multiplier) ?? 1)
				let pnl = response_trade.pnL - response_trade.fees

				let last_trade = trades[user].at(-1)

				if (last_trade && symbol == last_trade.symbol && start_date <= last_trade.end_date) {
					let count = last_trade.count
					last_trade.position += position
					last_trade.start_date = last_trade.start_date < start_date ? last_trade.start_date : start_date;
					last_trade.end_date = last_trade.end_date > end_date ? last_trade.end_date : end_date
					last_trade.entry_price = (last_trade.entry_price * count + response_trade.entryPrice) / (count + 1)
					last_trade.exit_price = (last_trade.exit_price * count + response_trade.exitPrice) / (count + 1)
					last_trade.pnl += pnl
					last_trade.count = count + 1

					continue
				}

				let trade = {
					symbol: symbol,
					position: position,
					start_date: start_date,
					end_date: end_date,
					entry_price: response_trade.entryPrice,
					exit_price: response_trade.exitPrice,
					pnl: pnl,
					count: 1,
				}

				trades[user].push(trade)
			}
		}
	}

	return trades
}

function calculate_stats (/** @type {trades} */ trades) {
	/** @type {stats} */
	let stats = {}

	for (let user in trades) {
		let won = 0
		let lost = 0
		let profit = 0
		let loss = 0

		for (let trade of trades[user]) {
			if (trade.pnl >= 0) {
				won++
				profit += trade.pnl
			} else {
				lost++
				loss += Math.abs(trade.pnl)
			}
		}

		let qty = won + lost
		let avg_profit = div(profit, won)
		let avg_loss = div(loss, lost)
		let win_rate = div(won, qty)
		let r = div(avg_profit, avg_loss)
		let edge = qty > 0 ? (win_rate * r) - ((1 - win_rate) * 1) : 0
		let balance = profit - loss
		let pnl_per_trade = div(balance, qty)
		let maturity_days = new Set(trades[user].map(t => `${t.end_date.getFullYear()}-${t.end_date.getMonth()}-${t.end_date.getDate()}`)).size;

		stats[user] = {
			qty,
			avg_profit,
			avg_loss,
			win_rate,
			r,
			edge,
			balance,
			pnl_per_trade,
			maturity_days
		}
	}

	return stats
}

async function create_stats_grid (/** @type {HTMLElement} */ element, /** @type {stats} */ stats, /** @type {board} */ board) {
	let data = []

	for (let user in stats) {
		let stat = stats[user]
		let shares = board.shares[user]
		data.push([
			user,
			stat.qty,
			stat.avg_profit,
			stat.avg_loss,
			stat.win_rate,
			stat.r,
			stat.edge,
			stat.pnl_per_trade,
			stat.balance,
			stat.maturity_days,
			shares.map(s => (s.account_type && s.account_type[0]) ?? '?').join(',')
		])
	}

	data.sort(function (a, b) {
		let a_edge = /** @type {number} */ (a[6])
		let b_edge = /** @type {number} */ (b[6])
		return b_edge - a_edge
	})

	// @ts-ignore
	let grid = new gridjs.Grid({
		columns: [
			{name: 'user'},
			{name: 'trades'},
			{name: 'avg_profit', formatter:  c},
			{name: 'avg_loss', formatter:  c},
			{name: 'win_rate', formatter:  p},
			{name: 'r', formatter:  f2},
			{name: 'edge', formatter:  f2},
			{name: 'pnl / trade', formatter:  c},
			{name: 'balance', formatter:  c},
			{name: 'Age (d)', formatter: n},
			{name: 'Type'}
		],
		data: data,
		fixedHeader: true,
		pagination: {
			buttonsCount: 0,
			limit: 25,
			summary: false,
		},
		search: true,
		sort: true,
	})

	grid.render(element)

	return grid
}

async function create_trades_grid (/** @type {HTMLElement} */ element, /** @type {trades} */ trades) {
	let data = []

	for (let user in trades) {
		for (let trade of trades[user]) {
			data.push([
				user,
				trade.symbol,
				trade.position,
				trade.start_date,
				trade.end_date,
				trade.entry_price,
				trade.exit_price,
				trade.pnl,
			])
		}
	}

	data.sort(function (a, b) {
		let a_start_date = /** @type {Date} */ (a[3])
		let b_start_date = /** @type {Date} */ (b[3])
		return b_start_date.getTime() - a_start_date.getTime()
	})

	// @ts-ignore
	let grid = new gridjs.Grid({
		columns: [
			{name: 'user'},
			{name: 'symbol'},
			{name: 'pos', formatter: f1},
			{name: 'start', formatter: d},
			{name: 'end', formatter: d},
			{name: 'entry', formatter: f2},
			{name: 'exit', formatter: f2},
			{name: 'pnl', formatter: c},
		],
		data: data,
		fixedHeader: true,
		pagination: {
			buttonsCount: 0,
			limit: 25,
			summary: false,
		},
		search: true,
		sort: true,
	})

	grid.render(element)

	return grid
}

function populate_symbols (/** @type {HTMLElement} */ element, /** @type {symbol_map} */ symbol_map) {
	if (!(element instanceof HTMLSelectElement))
		throw new Error('populate_symbols')

	for (let key in symbol_map) {
		let symbolMap = symbol_map[key]
		let symbol = symbolMap ? symbolMap.mapTo : key

		let exists = false

		for (let option of element.options) {
			if (option.value == symbol) {
				exists = true
				break
			}
		}

		if (exists)
			continue

		element.options.add(new Option(symbol, symbol))
	}

	return element
}

async function fetch_quotes (/** @type {string} */ symbol) {
	let proxy_url = decodeURIComponent('%68%74%74%70%73%3A%2F%2F%64%65%76%65%6C%2E%73%65%61%6E%64%75%6E%61%77%61%79%2E%63%6F%6D%2F%38%38%38%38%2F')
	let base_url = 'https://query1.finance.yahoo.com/v8/finance/chart/'
	let interval = '1m'
	let range = '5d'

	let url = `${proxy_url}${base_url}${symbol}=f?&interval=${interval}&range=${range}`

	let result
	try {
		let response = await fetch(url)
		let response_object = await response.json()
		result = response_object.chart.result[0]
	} catch (error) {
		console.error('fetch_quotes:', url)
	}

	/** @type {quotes} */
	let quotes = []

	for (let i = 0; i < result?.timestamp?.length; i++) {
		let date = new Date(result.timestamp[i] * 1000)
		let price = result.indicators.quote[0].close[i]
		if (!price)
			continue

		let quote = {
			date: date,
			price: price,
		}

		quotes.push(quote)
	}

	return quotes
}

function create_chart (/** @type {HTMLElement} */ element, /** @type {quotes} */ quotes, /** @type {trades} */ trades, /** @type {string} */ symbol) {
	// @ts-ignore
	let chart = echarts.init(element)

	let min_timestamp = Infinity
	let max_timestamp = -Infinity
	let min_quote = Infinity
	let max_quote = -Infinity

	let quotes_data = []

	for (let quote of quotes) {
		if (quote.date.getTime() < min_timestamp)
			min_timestamp = quote.date.getTime()

		if (quote.date.getTime() > max_timestamp)
			max_timestamp = quote.date.getTime()

		if (quote.price < min_quote)
			min_quote = quote.price

		if (quote.price > max_quote)
			max_quote = quote.price

		quotes_data.push([
			quote.date,
			quote.price,
		])
	}

	max_timestamp += 20 * 60 * 1000

	let trade_series = []

	for (let user in trades) {
		/** @type {chart_data} */
		let winning_data = []
		/** @type {chart_data} */
		let losing_data = []

		for (let trade of trades[user]) {
			if (trade.symbol !== symbol)
				continue

			if (trade.start_date.getTime() < min_timestamp)
				continue

			if (trade.end_date.getTime() > max_timestamp)
				continue

			if (trade.entry_price > max_quote)
				continue

			if (trade.entry_price < min_quote)
				continue

			let target

			if (trade.pnl >= 0)
				target = winning_data
			else
				target = losing_data

			target.push({value: [trade.start_date, trade.entry_price], pnl: trade.pnl})
			target.push({value: [trade.end_date, trade.exit_price], pnl: trade.pnl})
			target.push({value: [null, null], pnl: 0})
		}

		let series_defaults = {
			name: user,
			type: 'line',
			emphasis: {focus: 'series'},
			connectNulls: false,
			lineStyle: {width: 4},
			symbol: 'circle',
			symbolSize: 12,
		}

		if (winning_data.length > 0) {
			trade_series.push({
				...series_defaults,
				data: winning_data,
				lineStyle: {color: 'green', opacity: 0.20, width: 4},
			})
		}

		if (losing_data.length > 0) {
			trade_series.push({
				...series_defaults,
				data: losing_data,
				lineStyle: {color: 'red', opacity: 0.20, width: 4},
			})
		}
	}

	let default_zoom_start = quotes[quotes.length - 1].date.getTime() - 24 * 60 * 60 * 1000

	let options = {
		xAxis: {type: 'time', axisLabel: {color: 'gray'}, axisLine: false},
		yAxis: {type: 'value', axisLabel: {color: 'gray'}, min: 'dataMin', max: 'dataMax', position: 'right', splitLine: false},
		series: [{type: 'line', data: quotes_data, emphasis: {disabled: true}, lineStyle: {color: 'lightgray', width: 4}, showSymbol: false}, ...trade_series],
		dataZoom: [{startValue: default_zoom_start, endValue: max_timestamp}],
		grid: {top: 0, right: 0, bottom: 0, left: 0},
		legend: {show: true, backgroundColor: 'white', orient: 'vertical', type: 'scroll', top: 'middle', left: 0},
		tooltip: {trigger: 'item', formatter: function (/** @type {any} */ p) {return p.data?.pnl ? `<b>${p.seriesName}</b><br>${c(p.data.pnl)}` : ''}},
	}

	chart.setOption(options)

	let chart_dom = chart.getDom();
	chart_dom.addEventListener('dblclick', function () {chart.dispatchAction({type: 'dataZoom', startValue: default_zoom_start, endValue: max_timestamp})})

	return chart
}

function populate_random_quote (/** @type {HTMLElement} */ element) {
	let quotes = [
		['veritas', 'truth'],
		['in veritate', 'in truth'],
		['veritas vos liberabit', 'the truth will set you free'],
		['veritas nunquam perit', 'truth never dies'],
		['veritas odium parit', 'truth breeds hatred'],
		['veritas numquam latet', 'truth never lies hidden'],
		['magna est veritas et praevalebit', 'great is the truth, and it will prevail'],
		['res ipsa loquitur', 'the thing speaks for itself'],
		['ad augusta per angusta', 'to high places through narrow ways'],
		['acta, non verba', 'actions, not words'],
		['esse quam videri', 'to be rather than to seem'],
		['quid est veritas', 'what is truth'],
		['falsus in uno, falsus in omnibus', 'false in one thing, false in everything'],
		['ubi dubium ibi libertas', 'where there is doubt, there is freedom'],
		['a man may beat a horse race, but he cannot beat horse racing', 'jesse livermore'],
	]

	let min = 0
	let max = quotes.length - 1
	let random_index = Math.floor(Math.random() * (max - min + 1) + min)
	let random_quote = quotes[random_index]

	element.textContent = random_quote[0]
	element.title = random_quote[1]

	return random_quote
}

function div (numerator = 0, denominator = 0) {
	return denominator !== 0 ? numerator / denominator : 0;
}

function c (currency = 0.00) {
	return '$' + currency.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})
}

function d (date = new Date()) {
	return date.toLocaleString()
}

function f (float, precision) {
	return (float * 1.0).toFixed(precision)
}

function f1 (float = 0.00) {
	return f(float, 1)
}

function f2 (float = 0.00) {
	return f(float, 2)
}

function n (number = 0) {
	return number.toLocaleString('en-US', {maximumFractionDigits: 0})
}

function p (percent = 0.00) {
	return (percent * 100).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2}) + '%'
}

/**
 * @typedef {{
 * 	name: string,
 *	allow_practice: boolean,
 *	allow_combine: boolean,
 *	allow_xfa: boolean,
 *	allow_multiple: boolean,
 *	start_date: Date,
 *	end_date: Date,
 *	shares: {[user: string]: number[]},
 * }} board
 */

/**
 * @typedef {{
 * 	[key: string]: string
 * }} symbol_map
 */

/**
 * @typedef {{
 * 	[user: string]: {
 * 		symbol: string,
 * 		position: number,
 * 		start_date: Date,
 * 		end_date: Date,
 * 		entry_price: number,
 * 		exit_price: number,
 * 		pnl: number,
 * 		count: number,
 * 	}[]
 * }} trades
 */

/**
 * @typedef {{
 * 	[user: string]: {
 * 		qty: number,
 * 		avg_profit: number,
 * 		avg_loss: number,
 * 		win_rate: number,
 * 		r: number,
 * 		edge: number,
 * 		pnl_per_trade: number,
 * 		balance: number,
 * 	}
 * }} stats
 */

/**
 * @typedef {{
 * 	date: Date,
 * 	price: number,
 * }[]} quotes
 */

/**
 * @typedef {{
 * 	value: [Date | null, number | null],
 * 	pnl: number,
 * }[]} chart_data
 */
