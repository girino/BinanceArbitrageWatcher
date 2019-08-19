var config = require('./config.json')
var binance = require('node-binance-api')().options({
    APIKEY: config.API_KEY,
    APISECRET: config.SECRET_KEY,
    useServerTime: true,
    test: config.TEST
});

function buildMarkets(excInfo) {
    var ret = {};
    excInfo.symbols.forEach(element => {
        var minQty = element.filters.find(x => {
            return x.filterType == 'LOT_SIZE';
        }).minQty
        element.minQty = parseFloat(minQty);
        ret[element.symbol] = element;
    });
    return ret;
}

function buildMarketsByCoin(excInfo) {
    var ret = {};
    excInfo.symbols.forEach(element => {
        var minQty = element.filters.find(x => {
            return x.filterType == 'LOT_SIZE';
        }).minQty
        if ( !(element.baseAsset in ret) ) {
            ret[element.baseAsset] = [];
        }
        ret[element.baseAsset].push({
            symbol: element.symbol,
            baseAsset: element.baseAsset,
            quoteAsset: element.quoteAsset,
            other: element.quoteAsset,
            minQty: minQty
        });
        if ( !(element.quoteAsset in ret) ) {
            ret[element.quoteAsset] = [];
        }
        ret[element.quoteAsset].push({
            symbol: element.symbol,
            baseAsset: element.baseAsset,
            quoteAsset: element.quoteAsset,
            other: element.baseAsset,
            minQty: minQty
        });
    });
    return ret;
}

function buildPotentialTriads(markets, marketsByCoin, currencies) {
    var ret = [];
    currencies.forEach(first => {
        marketsByCoin[first].forEach(secondObj => {
            var second = secondObj.other;
            var secondIsBase = (secondObj.other == secondObj.baseAsset);
            marketsByCoin[second].forEach(thirdObj => {
                var third = thirdObj.other;
                var thirdIsBase = (thirdObj.other == thirdObj.baseAsset);
                marketsByCoin[third].forEach(fourthObj => {
                    var fourth = fourthObj.other;
                    var fourthIsBase = (fourthObj.other == fourthObj.baseAsset);
                    if (fourth == first) {
                        ret.push( new Triad({
                            coins: [first, second, third, fourth],
                            path: [secondObj.symbol, thirdObj.symbol, fourthObj.symbol],
                            isBase: [secondIsBase, thirdIsBase, fourthIsBase]
                        }));
                    }
                });
            });
        });
    });
    return ret;
}

function getTriadsByPair(triads) {
    var ret = {};
    triads.forEach(triad => {
        triad.path.forEach(pair => {
            if (!(pair in ret)) {
                ret[pair] = [];
            }
            ret[pair].push(triad);
        })
    })
    return ret;
}
function getTriadsByBaseCurrency(triads) {
    var ret = {};
    triads.forEach(triad => {
        var base = triad.coins[0];
        if (!(base in ret)) {
            ret[base] = [];
        }
        ret[base].push(triad);
    })
    return ret;
}

async function main() {
    try {
        var excInfo = await (new Promise((resolve, reject) => {
            binance.exchangeInfo((error, result)=> {
                if (error) reject(error);
                else resolve(result);
            });
        }));

        var markets = buildMarkets(excInfo);
        var marketsByCoin = buildMarketsByCoin(excInfo);
        var triads = buildPotentialTriads(markets, marketsByCoin, Object.keys(marketsByCoin));
        // var triads = buildPotentialTriads(markets, marketsByCoin, config.END_POINTS);
        var triadsByPair = getTriadsByPair(triads);
        var triadsByBaseCurrency = getTriadsByBaseCurrency(triads);


        // cancel all pending orders
        //await cancelPendingOrders();

        // account balances
        var balances = null;
        if (!config.WATCH_ONLY) {
            balances = await getBalanceMap();
        }

        console.log("=======================");
        console.log("Triades Carregadas: ", triads.length);
        console.log("=======================");

        var prevDayMap = {};
        binance.websockets.prevDay(false, (error, response) => {
            try {
                prevDayMap[response.symbol] = response;
                // findss all triads containing this pair.
                if (response.symbol in triadsByPair) {
                    triadsByPair[response.symbol].forEach (triad => {
                        triad.setTicker(response);
                    });
                }
            } catch (e0) {
                console.log(e0);
            }
        });

        setInterval(function () {
            coins = config.END_POINTS;
            if (!config.WATCH_ONLY) {
                coins = Object.keys(balances).filter(coin => {
                    return balances[coin].available > 0 && (coin in triadsByBaseCurrency);
                });
            }
            coins.forEach(coin => {
                triadsByBaseCurrency[coin].filter(triad => {
                    return triad.isComplete() &&
                        triad.dirty &&
                        (config.WATCH_ONLY || triad.compareBalance(balances[coin].available, markets[triad.path[0]].minQty));
                }).forEach(triad => {
                    var maxBalance = 999999999;
                    if (!config.WATCH_ONLY) {
                        maxBalance = balances[coin].available;
                    }
                    triad.checkForOportunities(maxBalance, markets[triad.path[0]].minQty);
                });
            });
        }, 2000);
    } catch (e1) {
        console.log(e1);
        return;
    }

}
main();

class Triad {
    coins;
    path;
    ticker;
    isBase;
    price = 0;
    volume = 0;
    constructor(mapa) {
        this.coins = mapa.coins;
        this.path = mapa.path;
        this.isBase = mapa.isBase;
        this.ticker = {};
        this.dirty = true;
    }
    isComplete() {
        return Object.keys(this.ticker).length == this.path.length;
    }
    compareBalance(balance, minQty) {
        if (this.isBase[0]) {
            return balance > minQty * this.ticker[this.path[0]].bestAsk ;
        } else {
            return balance > minQty;
        }
    }
    setTicker(ticker) {
        if (this.path.includes(ticker.symbol)) {
            this.dirty = true;
            this.ticker[ticker.symbol] = ticker;
        } else {
            console.log("Error: symbol not part of triad");
            console.log(ticker.symbol);
            console.log(this.path);
            return;
        }
    }
    checkForOportunities(balance, minLotQty) {
        var volume = balance;
        if (volume >= 0 && this.isComplete()) {
            var m2 = 1.0;
            // var v0 = []
            // var v1 = []
            // var m0 = []
            for (var i = 0; i < this.path.length; i++) {
                var symbol = this.path[i];
                var isBase = this.isBase[i];
                var ticker = this.ticker[symbol];
                if (isBase) {
                    m2 = m2 * ticker.bestBid;
                    if (volume > ticker.bestBidQty) {
                        volume = ticker.bestBidQty;
                    }
                    volume = volume * ticker.bestBid;
                    // v0.push(volume);
                    // v1.push(ticker.bestBidQty);
                    // m0.push(ticker.bestBid)
                } else {
                    m2 = m2 / ticker.bestAsk;
                    if (volume > ticker.bestAskQty) {
                        volume = ticker.bestAskQty;
                    }
                    volume = volume / ticker.bestAsk;
                    // v0.push(volume);
                    // v1.push(ticker.bestAskQty);
                    // m0.push(ticker.bestAsk)
                }
                m2 = m2 * (1.0 - config.FEES);
                volume = volume * (1.0 - config.FEES);
            };
            var minProfit = config.MIN_PROFIT;
            if (this.price != m2 && m2 > minProfit) {
                var minAmount = minLotQty;
                var gain = volume - (volume / m2);
                if (this.compareBalance(volume, minAmount) && this.compareBalance(gain, minLotQty)) {
                    console.log("********** ARBITRAGE OPORTUNITY ************");
                    console.log("Gain:", (m2 - 1.0) * 100, "%");
                    console.log(this.coins.join(" => "));
                    console.log("Max ammount:", volume / m2);
                    console.log("Total Gain:", gain);
                }
            }
            this.price = m2;
            this.volume = volume;
            this.dirty = false;
        }
    }
}

async function getBalanceMap() {
    return await (new Promise((resolve, reject) => {
        binance.balance((error, result) => {
            if (error)
                reject(error);
            else
                resolve(result);
        });
    }));
}

async function cancelPendingOrders() {
    console.log("=== Canceling Pending Orders...")
    var openOrders = await getOpenOrders();
    while (openOrders.length != 0) {
        openOrders.forEach(order => {
            await(new Promise((resolve, reject) => {
                binance.cancel(order.symbol, order.orderId, (error, result) => {
                    if (error)
                        reject(error);
                    resolve(result);
                    console.log("==== Canceled order", order.orderId)
                });
            }));
        });
        openOrders = await getOpenOrders();
    }
    console.log("=== Cancel Pending Orders Done.")
}

async function getOpenOrders() {
    return await (new Promise((resolve, reject) => {
        binance.openOrders(false, (error, orders) => {
            if (error)
                reject(error);
            else
                resolve(orders);
        });
    }));
}

