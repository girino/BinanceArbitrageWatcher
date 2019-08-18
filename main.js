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
        ret[element.symbol] = element;
    });
    return ret;
}

function buildMarketsByCoin(excInfo) {
    var ret = {};
    excInfo.symbols.forEach(element => {
        if ( !(element.baseAsset in ret) ) {
            ret[element.baseAsset] = [];
        }
        ret[element.baseAsset].push({
            symbol: element.symbol,
            baseAsset: element.baseAsset,
            quoteAsset: element.quoteAsset,
            other: element.quoteAsset
        });
        if ( !(element.quoteAsset in ret) ) {
            ret[element.quoteAsset] = [];
        }
        ret[element.quoteAsset].push({
            symbol: element.symbol,
            baseAsset: element.baseAsset,
            quoteAsset: element.quoteAsset,
            other: element.baseAsset
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

async function main() {
    var excInfo = await (new Promise((resolve, reject) => {
        binance.exchangeInfo((error, result)=> {
            if (error) reject(error);
            else resolve(result);
        });
    }));

    var markets = buildMarkets(excInfo);
    var marketsByCoin = buildMarketsByCoin(excInfo);
    // var triads = buildPotentialTriads(markets, marketsByCoin, Object.keys(marketsByCoin));
    var triads = buildPotentialTriads(markets, marketsByCoin, config.END_POINTS);
    var triadsByPair = getTriadsByPair(triads);

    console.log("=======================");
    console.log("Triades Carregadas: ", triads.length);
    console.log("=======================");

    var prevDayMap = {};
    try {
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
    } catch (e) {
        console.log(e);
    }

    // // create orderbooks for all pairs
    // var orderbooks = watchPairs.map(pair => { return new Orderbook(pair) })

    setInterval(function () {
        ;
    }, 10000);


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
        this.ticker = {}
    }
    isComplete() {
        return Object.keys(this.ticker).length == this.path.length;
    }
    setTicker(ticker) {
        if (this.path.includes(ticker.symbol)) {
            this.ticker[ticker.symbol] = ticker;
        } else {
            console.log("Error: symbol not part of triad");
            console.log(ticker.symbol);
            console.log(this.path);
            return;
        }
        // if triad OfflineAudioCompletionEvent, calculate prices
        if (this.isComplete()) {
            var m2 = 1.0;
            var volume = 9999;
            var v0 = []
            var v1 = []
            var m0 = []
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
                    v0.push(volume);
                    v1.push(ticker.bestBidQty);
                    m0.push(ticker.bestBid)
                } else {
                    m2 = m2 / ticker.bestAsk;
                    if (volume > ticker.bestAskQty) {
                        volume = ticker.bestAskQty;
                    }
                    volume = volume / ticker.bestAsk;
                    v0.push(volume);
                    v1.push(ticker.bestAskQty);
                    m0.push(ticker.bestAsk)
                }
                m2 = m2 * (1.0 - 0.001);
                volume = volume * (1.0 - 0.001);
            };
            if (this.price != m2 && m2 > 1.01) {
                var minAmount = 10.0;
                if (this.coins[0] == 'BTC') {
                    minAmount = 10.0 / 10000;
                }
                if (volume >= minAmount) {
                    console.log("********** ARBITRAGE OPORTUNITY ************");
                    console.log("Gain:", (m2 - 1.0) * 100, "%");
                    console.log(this.coins.join(" => "));
                    console.log("Max ammount:", volume / m2);
                    console.log("Total Gain:", volume - (volume / m2));
                }
            }
            this.price = m2;
            this.volume = volume;
        }
    }
}