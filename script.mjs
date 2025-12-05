let elements = get_elements()

let board_filename = get_board_filename()
let board = await fetch_board(board_filename)
let trades = await fetch_trades(board)
let stats = calculate_stats(trades)

// update_table(elements.table, stats)
create_grid(elements.stats, stats)

console.info('trades', trades)
console.info('stats', stats)

elements.name.textContent = board.name

function get_elements () {
	let ids = ['name', 'stats', 'table', 'chart']

	/** @type {elements} */
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
	let base_path = './boards'
	let filename_chunk = 'default'

	let params = window.location.search.slice(1)
	if (params)
		filename_chunk = params

	let board_filename = `${base_path}/${filename_chunk}.json`

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

async function fetch_trades (/** @type {board} */ board) {
	let url = 'https://userapi.topstepx.com/Trade/range'

	/** @type {trades} */
	let trades = {}

	for (let user in board.shares) {
		if (!trades[user])
			trades[user] = []

		let shares = board.shares[user]

		for (let share_id of shares) {
			let payload = {
				tradingAccountId: share_id,
				start: board.start_date.toISOString(),
				end: board.end_date.toISOString(),
			}

			/** @type {Response} */
			let response
			let response_array

			try {
				response = await fetch(url, {
					method: 'post',
					headers: {'content-type': 'application/json'},
					body: JSON.stringify(payload),
				})

				response_array = await response.json()
			} catch (error) {
				console.error('fetch_data:', user, share_id)
				continue
			}

			let scale_count = 0

			for (let response_trade of response_array) {
				let start_date = new Date(response_trade.createdAt)
				if (start_date < board.start_date)
					continue

				let end_date = new Date(response_trade.exitedAt)
				if (end_date > board.end_date)
					continue

				let pnl = (response_trade.pnL - response_trade.fees) / Math.abs(response_trade.positionSize)

				scale_count++

				let previous_trade = trades[user].at(-1)
				if (previous_trade && start_date < previous_trade.end_date) {
					previous_trade.entry_price = (previous_trade.entry_price * scale_count + response_trade.entryPrice) / (scale_count + 1)
					previous_trade.exit_price = (previous_trade.exit_price * scale_count + response_trade.exitPrice) / (scale_count + 1)
					previous_trade.pnl = (previous_trade.pnl * scale_count + pnl) / (scale_count + 1)

					continue
				}

				scale_count = 0

				let trade = {
					symbol: response_trade.symbolId,
					start_date: start_date,
					end_date: end_date,
					entry_price: response_trade.entryPrice,
					exit_price: response_trade.exitPrice,
					pnl: pnl,
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

		let number_of_trades = trades[user].length
		let total = won + lost
		let win_rate = div(won, total)
		let average_profit = div(profit, won)
		let average_loss = div(loss, lost)
		let reward_risk = div(average_profit, average_loss)
		let expectancy = (win_rate * reward_risk) - ((1 - win_rate) * 1)
		let pnl = profit - loss
		let average_pnl = div(pnl, total)

		stats[user] = {
			number_of_trades,
			win_rate,
			average_profit,
			average_loss,
			reward_risk,
			expectancy,
			average_pnl,
			pnl,
		}
	}

	return stats
}

function update_table (/** @type {HTMLElement} */ table, /** @type {stats} */ stats) {
	if (!(table instanceof HTMLTableElement))
		return

	while (table.rows.length > 1)
		table.deleteRow(1)

	for (let user in stats) {
		let row = table.insertRow()

		let user_cell = row.insertCell()
		user_cell.innerHTML = user

		let number_of_trades_cell = row.insertCell()
		number_of_trades_cell.innerHTML = p(stats[user].number_of_trades)

		let win_rate_cell = row.insertCell()
		win_rate_cell.innerHTML = p(stats[user].win_rate)

		let average_profit_cell = row.insertCell()
		average_profit_cell.innerHTML = c(stats[user].average_profit)

		let average_loss_cell = row.insertCell()
		average_loss_cell.innerHTML = c(stats[user].average_loss)

		let reward_risk_cell = row.insertCell()
		reward_risk_cell.innerHTML = f(stats[user].reward_risk)

		let expectancy_cell = row.insertCell()
		expectancy_cell.innerHTML = f(stats[user].expectancy)

		let average_pnl_cell = row.insertCell()
		average_pnl_cell.innerHTML = c(stats[user].average_pnl)

		let pnl_cell = row.insertCell()
		pnl_cell.innerHTML = c(stats[user].pnl)
	}
}

async function create_grid (/** @type {HTMLElement} */ element, /** @type {stats} */ stats) {
	// @ts-ignore
	let gridjs = await import('https://unpkg.com/gridjs?module')
	new gridjs.Grid({
		columns: [
			{name: 'user'},
			{name: '#'},
			{name: 'win rate', formatter:  p},
			{name: 'average profit', formatter:  c},
			{name: 'average_loss', formatter:  c},
			{name: 'r', formatter:  f},
			{name: 'expectancy', formatter:  f},
			{name: 'average pnl', formatter:  c},
			{name: 'total pnl', formatter:  c},
		],
		data: Object.entries(stats).map(([user, stat]) => [
			user,
			stat.number_of_trades,
			stat.win_rate,
			stat.average_profit,
			stat.average_loss,
			stat.reward_risk,
			stat.expectancy,
			stat.average_pnl,
			stat.pnl,
		]),
		sort: true,
	}).render(element)
}

function div (numerator = 0, denominator = 0) {
	return denominator !== 0 ? numerator / denominator : 0;
}

function c (currency = 0.00) {
	return '$' + currency.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})
}

function f (float = 0.0) {
	return float.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})
}

function n (number = 0) {
	return number.toLocaleString('en-US', {maximumFractionDigits: 0})
}

function p (percent = 0.0) {
	return (percent * 100).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2}) + '%'
}

/**
 * @typedef {{
 * 	[id: string]: HTMLElement,
 * }} elements
 */

/**
 * @typedef {{
 * 	name: string,
 *	allow_practice: boolean,
 *	allow_combine: boolean,
 *	allow_xfa: boolean,
 *	allow_multiple: boolean,
 *	start_date: Date,
 *	end_date: Date,
 *	shares: {
 *		[user: string]: number[],
 *	},
 * }} board
 */

/**
 * @typedef {{
 * 	[user: string]: {
 * 		symbol: string,
 * 		start_date: Date,
 * 		end_date: Date,
 * 		entry_price: number,
 * 		exit_price: number,
 * 		pnl: number,
 * 	}[]
 * }} trades
 */

/**
 * @typedef {{
 * 	[user: string]: {
 * 		number_of_trades: number,
 * 		win_rate: number,
 * 		average_profit: number,
 * 		average_loss: number,
 * 		reward_risk: number,
 * 		expectancy: number,
 * 		average_pnl: number,
 * 		pnl: number,
 * 	}
 * }} stats
 */
