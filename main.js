var config = require('./config.json')
var binance = require('node-binance-api')().options({
    APIKEY: config.API_KEY,
    APISECRET: config.SECRET_KEY,
    useServerTime: true,
    test: config.TEST
});

// strategies
const STRATEGY_MAP = {
    "STOP": stopStrategy,
    "SIMPLE": simpleStrategy,
    "SIMPLE+TENDENCY" : simpleTendencyStrategy, 
    "AVGPRICE": averagePriceStrategy, 
    "AVG+TENDENCY": averagePriceTendencyStrategy
}

const pair = config.PAIR;
const coin1 = pair[0];
const coin2 = pair[1];
const market = pair[0] + pair[1];
const tendencyMarket = config.TENDENCYPAIR[0] + config.TENDENCYPAIR[1];

var tickSize = 0;
var delta = 0;
var minQty = 0;
var stepSize = 0;
var minNotional = 0;

var filters = [];
function roundPrices(v) {
    return Number(v).toFixed(tickSize);
}
function roundAmounts(v) {
    return (Number(v) - minQty).toFixed(stepSize);
}
function comparePrice(a, b) {
    var diff = Number(a)-Number(b);
    if (diff > delta) return 1;
    if (diff < -delta) return -1;
    return 0;
}

function numdigits(v) {
    var x = Number(v);
    if (x == 0) return 0;
    var count = 0;
    while (x < 1) {
        x = 10*x;
        count = count +1;
    }
    return count;
}

function processParameters(symbols) {
    symbols.forEach((item) => {
        if (item.symbol == market) {
            filters = item.filters;
            console.log("Filters set.");
            filters.forEach((filter) => {
                if (filter.filterType == "PRICE_FILTER") {
                    delta = Number(filter.tickSize);
                    tickSize = numdigits(filter.tickSize);
                }
                else if (filter.filterType == "LOT_SIZE") {
                    minQty = Number(filter.minQty);
                    stepSize = numdigits(filter.stepSize);
                }
                else if (filter.filterType == "MIN_NOTIONAL") {
                    minNotional = Number(filter.minNotional);
                }
            });
        }
    });
    return {
        "delta": delta,
        "tickSize": tickSize,
        "minQty": minQty,
        "stepSize": stepSize,
        "minNotional": minNotional
    }
}

function getOnOrderAndAvailable(balances, coin) {
    if (balances[coin]) {
        return {
            onOrder: Number(balances[coin].onOrder), 
            available: Number(balances[coin].available)
        };
    } else {
        return {
            onOrder: 0.0, 
            available: 0.0
        };
    }
}

function printAndReturnBalance(balances, coin) {
    b = getOnOrderAndAvailable(balances, coin);
    var result = b.onOrder + b.available;
    console.log("SALDO " + coin + "...:", result, "(", b.available, "+", b.onOrder, ")" );
    return result;
}

async function main() {
    var excInfo = await (new Promise((resolve, reject) => {
        binance.exchangeInfo((error, result)=> {
            if (error) reject(error);
            else resolve(result);
        });
    }));
    var marketInfo = processParameters(excInfo.symbols);

    // start timed interval
    setInterval(function () {
        timedProcesses(marketInfo);
    }, 10000);
}
main();

function getBalances() {
    return new Promise((resolve, reject) => {
        binance.balance((error, result) => {
            if (error) reject(error);
            else resolve(result);
        });
    });
}

async function timedProcesses(marketInfo) {
    var prevDay = await getPrevDay(market);

    printHeader(await getBalances(), prevDay, coin2, coin1);
    var openOrders = await getOpenOrders();
    if (STRATEGY_MAP[config.STRATEGY]) {
        STRATEGY_MAP[config.STRATEGY](prevDay, openOrders);
    }
}

function printHeader(balances, prevDay, base, currency) {
    console.clear();
    console.log("==========================================");
    var total = printAndReturnBalance(balances, currency);
    total *= Number(prevDay.lastPrice);
    total += printAndReturnBalance(balances, base);
    console.log("SALDO TOTAL..:", total, base);
    console.log("SALDO INICIAL:", config.INITIAL_INVESTMENT, base);
    console.log("LUCRO........:", total - config.INITIAL_INVESTMENT, base);
    dateAtual = new Date();
    console.log("@", dateAtual.getHours() + ':' + dateAtual.getMinutes() + ':' + dateAtual.getSeconds());
    console.log("==========================================");
}

function averagePriceTendencyStrategy(prevDay, openOrders) {
    simpleStrategy(prevDay, openOrders, averageTendencyStrategyPrices);
}
function averagePriceStrategy(prevDay, openOrders) {
    simpleStrategy(prevDay, openOrders, averagePriceStrategyPrices);
}
function simpleTendencyStrategy(prevDay, openOrders) {
    simpleStrategy(prevDay, openOrders, simpleTendencyStrategyPrices);
}

async function simpleStrategy(prevDay, openOrders, priceFunction=simpleStrategyPrices) {
    var prices = await priceFunction(prevDay);

    await logSimple(prices, prevDay, openOrders);
    await cancelOrders(openOrders, prices);
    await createSimpleOrders(prices);
}

async function simpleStrategyPrices() {
    var buy = config.BUY_PRICES[0];
    var sell = config.SELL_PRICES[0];
    return {buy, sell};
}

async function simpleTendencyStrategyPrices() {
    var tendency = await getPrevDay(tendencyMarket);
    if (tendency.priceChangePercent > 0) {
        return simpleStrategyPrices();
    } else { // simple + tendency
        var buy = config.BUY_PRICES[1];
        var sell = config.SELL_PRICES[1];
        return {buy, sell};
    }
}

async function averageTendencyStrategyPrices(prevDay) {
    var tendency = await getPrevDay(tendencyMarket);
    var weightedAvgPrice = Number(prevDay.weightedAvgPrice);
    var spread = config.SPREAD;
    if (comparePrice(tendency.lastPrice, tendency.weightedAvgPrice) > 0) {
        if (Number(tendency.priceChangePercent) > 0) {
            // both up, buy at market, sell at 2* spread
            return { 
                buy: weightedAvgPrice, 
                sell: weightedAvgPrice * (1 + (2*spread)) 
            };
        }
    } else if (comparePrice(tendency.lastPrice, tendency.weightedAvgPrice) < 0) {
        if (Number(tendency.priceChangePercent) < 0) {
            return {
                buy: weightedAvgPrice * (1 - (2*spread)),
                sell: weightedAvgPrice
            };
        }
    } 
    return averagePriceStrategyPrices(prevDay);
}


function getPrevDay(market) {
    return new Promise((resolve, reject) => {
        binance.prevDay(market, (error, tendency, symbol) => {
            if (error) reject(error);
            else resolve(tendency);
        });
    });
}

async function averagePriceStrategyPrices(prevDay) {
    var weightedAvgPrice = Number(prevDay.weightedAvgPrice);
    var spread = config.SPREAD;
    return {
        buy: weightedAvgPrice * (1 - spread),
        sell: weightedAvgPrice * (1 + spread)
    };
}

function logSimple(prices, prevDay, openOrders) {
    console.log("Cotação " + market, prevDay.lastPrice);
    console.log("Preço Medio " + market, prevDay.weightedAvgPrice);
    console.log("Definidos: compra " + roundPrices(prices.buy) + " e venda " + roundPrices(prices.sell));
    console.log("============== Open Orders ===============");
    openOrders.forEach(function (item) {
        console.log("[", item.orderId, ",", item.side, ",", item.symbol, ", amount:", item.origQty, ", price:", item.price, "]");
    });
    listExecutedOrders();
}

async function createSimpleOrders(prices) {
    var balances = await getBalances();
    var buy = roundPrices(prices.buy);
    var sell = roundPrices(prices.sell);
    if (balances[coin2] && Number(roundAmounts(balances[coin2].available)) > minNotional) {
        console.log("Compra: " + buy);
        binance.buy(market, roundAmounts(balances[coin2].available / buy), buy);
    }
    if (balances[coin1] && Number(roundAmounts(Number(balances[coin1].available) * sell)) > minNotional) {
            console.log("Venda: " + sell);
        binance.sell(market, roundAmounts(balances[coin1].available), sell);
    }
}

function simpleOrderCancelValidator(order, prices) {
    var buy = roundPrices(prices.buy);
    var sell = roundPrices(prices.sell);
    if ((order.side == "BUY" && comparePrice(order.price, buy) != 0) || (order.side == "SELL" && comparePrice(order.price, sell) != 0)) {
        return "Price out of range";
    } else if (order.symbol != market) {
        return "Wrong market";
    } else {
        return false;
    }
}

async function cancelWithReason(order, reason) {
    if (reason) {
        return await new Promise((resolve, reject) => {
            binance.cancel(order.symbol, order.orderId, (error, result) => {
                if (error) reject(error);
                else resolve("Canceling order " + result.orderId + ": " + reason);
            });
        });
    } else {
        return false;
    }
}

async function cancelOrders(openOrders, prices, cancelValidator=simpleOrderCancelValidator) {
    (await Promise.all(openOrders.map((order) => {
        return cancelWithReason(order, cancelValidator(order, prices));
    }))).filter(Boolean).map((msg) => {console.log(msg)});
}

async function getOpenOrders() {
    return await new Promise((resolve, reject) => {
        binance.openOrders(false, (error, openOrders) => {
            if (error)
                reject(error);
            resolve(openOrders);
        });
    });
}

function stopStrategy(balances) {
    binance.prevDay(market, (error, prevDay, symbol) => {
        if (error)
            return console.error(error);
        var price = Number(prevDay.lastPrice);
        var spread = config.SPREAD;
        var stopBuy = price * (1 + spread);
        var buy = price * (1 + 2*spread);
        var stopSell = price * (1 - spread);
        var sell = price * (1 - 2*spread);

        // adjusts to 4 decimals
        buy = roundPrices(buy);
        sell = roundPrices(sell);
        stopBuy = roundPrices(stopBuy);
        stopSell = roundPrices(stopSell);

        console.log("Cotação", market, prevDay.lastPrice, ", média 24h:", prevDay.weightedAvgPrice);
        console.log("Stops: compra " + stopBuy + " e venda " + stopSell);
        console.log("Preços: compra " + buy + " e venda " + sell);

        var cancelPromises = [];
        
        var openOrdersPromise = new Promise((resolve, reject) => {
            binance.openOrders(false, (error, openOrders) => {
                if (error) {
                    reject(error);
                    return console.error(error);
                }
                var toCancel = false;
                var reason = "";
                if (openOrders) {
                    console.log("============== Open Orders ===============");
                    openOrders.forEach(function (item) {
                        console.log("[", item.orderId, ",", item.side, ",", item.symbol, 
                                ", amount:", roundAmounts(item.origQty), 
                                ", price:", roundPrices(item.price), 
                                ", stop:", roundPrices(item.stopPrice), "]");
                        // cancel all orders that are not stop
                        if (item.type != 'STOP_LOSS' && item.type != 'STOP_LOSS_LIMIT') {
                            reason = "Not STOP_LOSS or STOP_LOSS_LIMIT";
                            toCancel = true;
                        }
                        // cancel buy orders below stop limit
                        if (!toCancel && item.symbol != market) {
                            reason = "Wrong market";
                            toCancel = true;
                        }
                        // cancel buy orders below stop limit
                        if (!toCancel && item.side == "BUY" && comparePrice(item.stopPrice, stopBuy) > 0) {
                            reason = "stopPrice > stopBuy";
                            toCancel = true;
                        }
                        // cancel sell orders above stop limit
                        if (!toCancel && item.side == "SELL" && comparePrice(item.stopPrice, stopSell) < 0) {
                            reason = "stopPrice < stopSell";
                            toCancel = true;
                        }
                        if (toCancel) {
                            var symbol = item.symbol;
                            var orderId = item.orderId;
                            console.log("Canceling order", orderId, ":", reason);
                            var promise = new Promise((reresolve, rereject) => {
                                binance.cancel(symbol, orderId, (error, openOrders) => {
                                    if (error) {
                                        rereject(error);
                                        return console.log(error)
                                    }
                                    reresolve("Success!");
                                    console.log("canceled order: ", orderId)
                                });
                            });
                            cancelPromises.push(promise);
                        }
                    });
                    console.log("============== Open Orders ===============");
                }
                resolve("Success!")
            });
        });
        openOrdersPromise.then(() => {
            Promise.all(cancelPromises).then(() => {
                listExecutedOrders().then((result) => {
                    placeStopOrders(prevDay, stopBuy, buy, stopSell, sell, result).then(() => {});
                })
            });
        });
    });
}

function placeStopOrders(prevDay, stopBuy, buy, stopSell, sell, lastPrices) {
    // get balances again
    return new Promise((resolve, reject) => {
        binance.balance((error, balances) => {
            if (error) {
                reject(error);
                return console.log(error)
            }
            var weightedAvgPrice = Number(prevDay.weightedAvgPrice);
            var orderPromises = [];
            if (balances[coin2] && Number(roundAmounts(balances[coin2].available)) > minNotional) {
                if (comparePrice(stopBuy, weightedAvgPrice) < 0 /*&& comparePrice(buy, lastPrices.sell) < 0*/) {
                    orderPromises.push(new Promise((res, rej) => {
                        console.log("Compra: " + stopBuy);
                        binance.order("BUY", market, roundAmounts(balances[coin2].available / buy), buy, {
                            type: "STOP_LOSS_LIMIT",
                            stopPrice: stopBuy
                        }, (error, result) => {
                            if (error) { rej(error); return console.log(error.body); }
                            console.log(result);
                            res();
                        });
                    }));
                } else {
                    console.log("Price too high, not buying.", stopBuy, "<=", weightedAvgPrice, "=", comparePrice(stopBuy, weightedAvgPrice) < 0);
                    /*console.log("Price too high, not buying.", buy, "<=", lastPrices.sell, "=", comparePrice(buy, lastPrices.sell) < 0)*/;
                }
            }
            if (balances[coin1] && Number(roundAmounts(Number(balances[coin1].available) * sell)) > minNotional) {
                if (/*comparePrice(stopSell, weightedAvgPrice) > 0 &&*/ comparePrice(sell, lastPrices.buy) > 0) {
                    orderPromises.push(new Promise((res, rej) => {
                        console.log("Venda: " + stopSell);
                        binance.order("SELL", market, roundAmounts(balances[coin1].available), sell, {
                            type: "STOP_LOSS_LIMIT",
                            stopPrice: stopSell
                        }, (error, result) => {
                            if (error) { rej(error); return console.log(error.body); }
                            console.log(result);
                            res();
                        });
                    }));
                } else {
                    //console.log("Price too low, not selling.", stopSell, ">=", weightedAvgPrice, "=", comparePrice(stopSell, weightedAvgPrice) > 0);
                    console.log("Price too low, not selling.", sell, ">=", lastPrices.buy, "=", comparePrice(sell, lastPrices.buy) > 0);
                }
            }
            if (orderPromises) {
                Promise.all(orderPromises).then(() =>{resolve();});
            } else {
                resolve();
            }
        });
    });
}

async function listExecutedOrders() {
    var count = 0;
    var lastBuy = false;
    var lastSell = false;
    console.log("============== Order History =============");
    (await new Promise((resolve, reject) => {
        binance.allOrders(market, (error, orders) => {
            if (error) reject(error)
            else resolve(orders);
        })}
    )).sort((a,b) => {
        return b.time - a.time;
    }).forEach((order) => {
        if (order.status == "FILLED" || order.status == "PARTIALLY_FILLED") {
            var time = new Date(Number(order.time)).toISOString();
            var price = roundPrices(Number(order.cummulativeQuoteQty) / Number(order.executedQty));
            var target = roundPrices(order.stopPrice != 0 ? order.stopPrice : order.price);
            var executed = Number(order.executedQty).toFixed(stepSize);
            var side = order.side == "BUY" ? "BUY " : "SELL";
            if (!lastBuy && side == "BUY ") {
                lastBuy = Number(price);
            }
            if (!lastSell && side == "SELL") {
                lastSell = Number(price);
            }
            // processes all, prints only 3
            if (count++ >= 3) return;
            console.log("[", time, order.status , order.symbol, ",", side, ", executed:", executed, ", target:", target, ", price:", price, "]");
        }
    });
    return {"sell": lastSell, "buy": lastBuy};
}
