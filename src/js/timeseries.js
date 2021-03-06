import Changelog from './changelog';
import { Colors } from './colors';
import debounce from './debounce';
import { el, prettyDate, chartExportOptions } from './utils';


function timeseries(metric, options, start, end) {
	const dataUrl = `https://cdn.httparchive.org/reports/${metric}.json`;
	options.chartId = `${metric}-chart`;
	options.tableId = `${metric}-table`;
	options.metric = metric;

	fetch(dataUrl)
		.then(response => response.text())
		.then(jsonStr => JSON.parse(jsonStr))
		.then(data => data.sort((a, b) => a.date < b.date ? -1 : 1))
		.then(data => {
			let [YYYY, MM, DD] = start.split('_');
			options.min = Date.UTC(YYYY, MM - 1, DD);
			[YYYY, MM, DD] = end.split('_');
			options.max = Date.UTC(YYYY, MM - 1, DD);

			drawTimeseries(data, options);
			drawTimeseriesTable(data, options, [options.min, options.max]);
		});
}

function drawTimeseries(data, options) {
	data = data.map(toNumeric);
	const desktop = data.filter(isDesktop);
	const mobile = data.filter(isMobile);

	const series = [];
	if (desktop.length) {
		if (options.timeseries && options.timeseries.fields) {
			options.timeseries.fields.forEach(field => {
				series.push(getLineSeries('Desktop', desktop.map(o => [o.timestamp, o[field]]), Colors.DESKTOP));
			});
		} else {
			series.push(getLineSeries('Desktop', desktop.map(toLine), Colors.DESKTOP));
			series.push(getAreaSeries('Desktop', desktop.map(toIQR), Colors.DESKTOP));
			series.push(getAreaSeries('Desktop', desktop.map(toOuts), Colors.DESKTOP, 0.05));
		}
	}
	if (mobile.length) {
		if (options.timeseries && options.timeseries.fields) {
			options.timeseries.fields.forEach(field => {
				series.push(getLineSeries('Mobile', mobile.map(o => [o.timestamp, o[field]]), Colors.MOBILE));
			});
		} else {
			series.push(getLineSeries('Mobile', mobile.map(toLine), Colors.MOBILE));
			series.push(getAreaSeries('Mobile', mobile.map(toIQR), Colors.MOBILE));
			series.push(getAreaSeries('Mobile', mobile.map(toOuts), Colors.MOBILE, 0.05));
		}
	}

	if (!series.length) {
		console.error('No timeseries data to draw', data, options);
		return;
	}

	getFlagSeries().then(flagSeries => {
		series.push(flagSeries);
		drawChart(options,series);
	})
}
let redrawTimeseriesTable = {};
function drawTimeseriesTable(data, options, [start, end]=[-Infinity, Infinity]) {
	if (!redrawTimeseriesTable[options.metric]) {
		// Return a curried function to redraw the table given start/end times.
		redrawTimeseriesTable[options.metric] = debounce((dateRange) => {
			return drawTimeseriesTable(data, options, dateRange);
		}, 100);
	}

	let cols = DEFAULT_COLS.concat(DEFAULT_FIELDS);
	if (options.timeseries && options.timeseries.fields) {
		cols = DEFAULT_COLS.concat(options.timeseries.fields);
	}

	Promise.resolve(zip(data)).then(data => {
		const table = document.getElementById(options.tableId);
		Array.from(table.children).forEach(child => table.removeChild(child));

		const frag = document.createDocumentFragment();
		const thead = el('thead');

		if (!options.timeseries || !options.timeseries.fields) {
			const trMeta = el('tr');
			trMeta.classList.add('meta-row');
			DEFAULT_COLS.map(col => {
				return el('th');
			}).forEach(th => trMeta.appendChild(th));
			const th = el('th');
			th.classList.add('text-center');
			th.setAttribute('colspan', cols.length - DEFAULT_COLS.length);
			th.textContent = 'Percentile' + (th.colspan === 1 ? '' : 's');
			trMeta.appendChild(th);
			thead.appendChild(trMeta);
		}

		const tr = el('tr');
		cols.map(col => {
			const th = el('th');
			th.textContent = col;
			return th;
		}).forEach(th => tr.appendChild(th));
		thead.appendChild(tr);
		frag.appendChild(thead);

		const tbody = el('tbody');
		data.forEach(([date, arr]) => {
			if (date < start || date > end) {
				return;
			}

			arr.forEach((o, i) => tbody.appendChild(toRow(o, i, arr.length, cols)));
		});
		frag.appendChild(tbody);
		table.appendChild(frag);
	});
}

const isDesktop = o => o.client == 'desktop';
const isMobile = o => o.client == 'mobile';
const toNumeric = o => ({
	timestamp: +o.timestamp,
	p10: +o.p10,
	p25: +o.p25,
	p50: +o.p50,
	p75: +o.p75,
	p90: +o.p90,
	percent: +o.percent,
	client: o.client
});
const toIQR = o => [o.timestamp, o.p25, o.p75];
const toOuts = o => [o.timestamp, o.p10, o.p90];
const toLine = o => [o.timestamp, o.p50];
const getLineSeries = (name, data, color) => ({
	name,
	type: 'line',
	data,
	color,
	zIndex: 1,
	marker: {
		enabled: false
	}
});
const getAreaSeries = (name, data, color, opacity=0.1) => ({
	name,
	type: 'areasplinerange',
	linkedTo: ':previous',
	data,
	lineWidth: 0,
	color,
	fillOpacity: opacity,
	zIndex: 0,
	marker: {
		enabled: false,
		states: {
			hover: {
				enabled: false
			}
		}
	}
});
const flags = {};
let changelog = null;
const loadChangelog = () => {
	if (!changelog) {
		changelog = fetch(Changelog.URL).then(response => response.json());
	}

	return changelog;
};
const getFlagSeries = () => loadChangelog().then(data => {
	data.forEach(change => {
		flags[+change.date] = {
			title: change.title,
			desc: change.desc
		};
	});
	return {
		type: 'flags',
		name: 'Changelog',
		data: data.map((change, i) => ({
			x: change.date,
			title: String.fromCharCode(65 + (i % 26))
		})),
		color: '#90b1b6',
		y: 25,
		showInLegend: false
	};
});

function drawChart(options, series) {
	Highcharts.stockChart(options.chartId, {
		metric: options.metric,
		type: 'timeseries',
		chart: {
			zoomType: 'x'
		},
		title: {
			text: `Timeseries of ${options.name}`
		},
		subtitle: {
			text: 'Source: <a href="http://httparchive.org">httparchive.org</a>',
			useHTML: true
		},
		legend: {
			enabled: true
		},
		tooltip: {
			crosshairs: true,
			shared: true,
			useHTML: true,
			borderColor: 'rgba(247,247,247,0.85)',
			formatter: function() {
				function getChangelog(changelog) {
					if (!changelog) return '';
					return `<p class="changelog">${changelog.title}</p>`;
				}

				const changelog = flags[this.x];
				const tooltip = `<p style="font-size: smaller;">${Highcharts.dateFormat('%b %e, %Y', this.x)}</p>`;

				// Handle changelog tooltips first.
				if (!this.points) {
					return `${tooltip} ${getChangelog(changelog)}`
				}

				function getRow(points) {
					if (!points.length) return '';
					if (options.timeseries && options.timeseries.fields) {
						return `<tr>
							<td><span style="color: ${points[0].series.color}">&bull;</span> ${points[0].series.name}</td>
							${points.map(point => {
								return `<th>${point.point.y.toFixed(1)}</th>`;
							})}
						</tr>`;
					}
					const [median, iqr, outs] = points;
					return `<tr>
						<td><span style="color: ${median.series.color}">&bull;</span> ${median.series.name}</td>
						<th>${outs.point.low.toFixed(1)}</th>
						<th>${iqr.point.low.toFixed(1)}</th>
						<th>${median.point.y.toFixed(1)}</th>
						<th>${iqr.point.high.toFixed(1)}</th>
						<th>${outs.point.high.toFixed(1)}</th>
					</tr>`;
				}
				const desktop = this.points.filter(o => o.series.name == 'Desktop');
				const mobile = this.points.filter(o => o.series.name == 'Mobile');
				return `${tooltip}
				<table cellpadding="5">
					<tr>
					<td></td>
					${
						(options.timeseries && options.timeseries.fields) ?
						options.timeseries.fields.map(field => {
							return `<td style="font-size: smaller;">${field}</td>`;
						}) : 
						`<td style="font-size: smaller;">10%ile</td>
						<td style="font-size: smaller;">25%ile</td>
						<td style="font-size: smaller;">50%ile</td>
						<td style="font-size: smaller;">75%ile</td>
						<td style="font-size: smaller;">90%ile</td>`
					}
				</tr>
				${getRow(desktop)}
				${getRow(mobile)}
				</table>
				${getChangelog(changelog)}`;
			}
		},
		xAxis: {
			type: 'datetime',
			events: {
				setExtremes: e => redrawTimeseriesTable[options.metric]([e.min, e.max])
			},
			min: options.min,
			max: options.max
		},
		yAxis: {
			title: {
				text: `${options.name}${options.redundant ? '' : ` (${options.type})`}`
			},
			opposite: false,
			min: 0
		},
		series,
		credits: false,
		exporting: chartExportOptions
	});
}

const DEFAULT_FIELDS = ['p10', 'p25', 'p50', 'p75', 'p90'];
const DEFAULT_COLS = ['date', 'client'];
const toFixed = value => parseFloat(value).toFixed(1);
const formatters = {
	date: prettyDate,
	p10: toFixed,
	p25: toFixed,
	p50: toFixed,
	p75: toFixed,
	p90: toFixed
};

const zip = data => {
	const dates = {};
	data.forEach(o => {
		let row = dates[o.timestamp];
		if (row) {
			row.push(o);
			row.sort((a, b) => a.client == 'desktop' ? -1 : 1)
			return;
		}
		dates[o.timestamp] = [o];
	});
	return Object.entries(dates).sort(([a], [b]) => a > b ? -1 : 1);
};

const toRow = (o, i, n, cols) => {
	const row = el('tr');
	cols.map(col => {
		const td = el('td');
		let text = o[col];
		const formatter = formatters[col];
		if (formatter) {
			text = formatter(o[col]);
		}
		td.textContent = text;
		return td;
	}).forEach(td => td && row.appendChild(td));
	return row;
};

// Export directly to global scope for use by Jinja template.
window.timeseries = timeseries;
