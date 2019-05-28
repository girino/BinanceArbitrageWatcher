var config = require('./config.json')
var binance = require('node-binance-api')().options({
    APIKEY: config.API_KEY,
    APISECRET: config.SECRET_KEY,
    useServerTime: true
});

setInterval(function () {
    var dateAtual = new Date();
    const pair = config.PAIR;
    const coin1 = pair.substr(0, 4);
    const coin2 = pair.substr(4,4);
    binance.balance((error, balances) => {
        if (error) return console.error(error);
        binance.prevDay(pair, (error, prevDay, symbol) => {
            if (error)
                return console.error(error);
            var balance1 = 0;
            if (balances[coin1]) {
                balance1 = parseFloat(balances[coin1].onOrder) + parseFloat(balances[coin1].available);
            }
            var balance2 = 0;
            if (balances[coin2]) {
                balance2 = parseFloat(balances[coin2].onOrder) + parseFloat(balances[coin2].available);
            }

            const total = (balance1 * Number(prevDay.lastPrice)) + balance2;
            console.clear();
            console.log("==========================================");
            console.log("SALDO " + coin1 + "...:", balance1, "USD", "(", balances[coin1].available, "+", balances[coin1].onOrder, ")" );
            console.log("SALDO " + coin2 + "...:", balance2, "USD", "(", balances[coin2].available, "+", balances[coin2].onOrder, ")" );
            console.log("SALDO TOTAL..:", total, "USD")
            console.log("SALDO INICIAL:", config.INITIAL_INVESTMENT, "USD")
            console.log("LUCRO........:", total - config.INITIAL_INVESTMENT, "USD")
            dateAtual = new Date();
            console.log("@", dateAtual.getHours() + ':' + dateAtual.getMinutes() + ':' + dateAtual.getSeconds());
            console.log("==========================================");
            if (config.STRATEGY == "SIMPLE" || config.STRATEGY == "SUPERSIMPLE") {
                simpleStrategy(pair, balances, prevDay);
            } else if (config.STRATEGY == "STOP") {
                stopStrategy(pair, balances, prevDay);
            }
        });
    });
}, 10000)

function simpleStrategy(pair, balances, prevDay) {
    var buy = config.BUY_PRICE;
    var sell = config.SELL_PRICE;
    var weightedAvgPrice = prevDay.weightedAvgPrice;
    var spread = config.SPREAD;
    buy = weightedAvgPrice * (1 - spread);
    sell = weightedAvgPrice * (1 + spread);
    buy = buy.toFixed(4);
    sell = sell.toFixed(4);
    console.log("Cotação " + pair, prevDay.lastPrice);
    console.log("Preço Medio " + pair, prevDay.weightedAvgPrice);
    console.log("Definidos: compra " + buy + " e venda " + sell);
    if (balances.USDT.available > 20) {
        console.log("Compra: " + buy);
            binance.buy(pair, ((balances.USDT.available - 0.1) / buy).toFixed(2), buy);
    }
    if (balances.TUSD.available > 20) {
        console.log("Venda: " + sell);
            binance.sell(pair, (balances.TUSD.available - 0.1).toFixed(2), sell);
    }
    binance.openOrders(false, (error, openOrders) => {
        if (error)
            return console.error(error);
        if (openOrders) {
            openOrders.forEach(function (item) {
                console.log("[", item.orderId, ",", item.side, ",", item.symbol, ", amount:", item.origQty, ", price:", item.price, "]");
                if ((item.side == "BUY" && item.price < buy) || (item.side == "SELL" && item.price > sell)) {
                    binance.cancel(item.symbol, item.orderId);
                    console.log("Price out of range, canceling order...");
                }
            });
        }
    });
}


function simpleStrategy(pair, balances, prevDay) {
    var buy = 0;
    var sell = 0;
    if (config.STRATEGY == "SIMPLE") {
        var weightedAvgPrice = Number(prevDay.weightedAvgPrice);
        var spread = config.SPREAD;
        buy = weightedAvgPrice * (1 - spread);
        sell = weightedAvgPrice * (1 + spread);
        createSimpleOrders(buy, sell, pair, prevDay, balances);
    } else {
        binance.prevDay("BTCUSDT", (error, prevDay, symbol) => {
            if (error)
                return console.error(error);
            if (prevDay.priceChangePercent > 0) {
                buy = config.BUY_PRICES[0];
                sell = config.SELL_PRICES[0];
            } else {
                buy = config.BUY_PRICES[1];
                sell = config.SELL_PRICES[1];
            }
            createSimpleOrders(buy, sell, pair, prevDay, balances);
        });
    }
}

function createSimpleOrders(buy, sell, pair, prevDay, balances) {
    buy = buy.toFixed(4);
    sell = sell.toFixed(4);
    console.log("Cotação " + pair, prevDay.lastPrice);
    console.log("Preço Medio " + pair, prevDay.weightedAvgPrice);
    console.log("Definidos: compra " + buy + " e venda " + sell);
    if (balances.USDT.available > 20) {
        console.log("Compra: " + buy);
        binance.buy(pair, ((balances.USDT.available - 0.1) / buy).toFixed(2), buy);
    }
    if (balances.TUSD.available > 20) {
        console.log("Venda: " + sell);
        binance.sell(pair, (balances.TUSD.available - 0.1).toFixed(2), sell);
    }
    binance.openOrders(false, (error, openOrders) => {
        if (error)
            return console.error(error);
        if (openOrders) {
            console.log("============== Open Orders ===============");
            openOrders.forEach(function (item) {
                console.log("[", item.orderId, ",", item.side, ",", item.symbol, ", amount:", item.origQty, ", price:", item.price, "]");
                if ( (item.side == "BUY" && compare(item.price, buy) > 0) || (item.side == "SELL" && compare(item.price, sell) < 0) ) {
                    binance.cancel(item.symbol, item.orderId);
                    console.log("Price out of range, canceling order...");
                }
            });
            console.log("============== Open Orders ===============");
        }
    });
    return { buy, sell };
}

function compare(a, b, delta = 0.0001) {
    var diff = Number(a)-Number(b);
    if (diff > delta) return 1;
    if (diff < -delta) return -1;
    return 0;
}

function stopStrategy(pair, balances) {
    try {
        binance.prevDay(pair, (error, prevDay, symbol) => {
            if (error)
                return console.error(error);
            var price = Number(prevDay.lastPrice);
            var spread = config.SPREAD;
            var stopBuy = price * (1 + spread);
            var buy = price * (1 + 2*spread);
            var stopSell = price * (1 - spread);
            var sell = price * (1 - 2*spread);

            // adjusts to 4 decimals
            buy = buy.toFixed(4);
            sell = sell.toFixed(4);
            stopBuy = stopBuy.toFixed(4);
            stopSell = stopSell.toFixed(4);

            console.log("Cotação", pair, prevDay.lastPrice);
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
                                    ", amount:", Number(item.origQty).toFixed(4), 
                                    ", price:", Number(item.price).toFixed(4), 
                                    ", stop:", Number(item.stopPrice).toFixed(4), "]");
                            // cancel all orders that are not stop
                            if (item.type != 'STOP_LOSS' && item.type != 'STOP_LOSS_LIMIT') {
                                reason = "Not STOP_LOSS or STOP_LOSS_LIMIT";
                                toCancel = true;
                            }
                            // cancel buy orders below stop limit
                            if (!toCancel && item.side == "BUY" && compare(item.stopPrice, stopBuy) > 0) {
                                reason = "stopPrice > stopBuy";
                                toCancel = true;
                            }
                            // cancel sell orders above stop limit
                            if (!toCancel && item.side == "SELL" && compare(item.stopPrice, stopSell) < 0) {
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
                if (cancelPromises) {
                    Promise.all(cancelPromises).then(() => {
                        placeStopOrders(balances, stopBuy, pair, buy, stopSell, sell);
                    });
                } else {
                    placeStopOrders(balances, stopBuy, pair, buy, stopSell, sell);
                }
            });
        });
    }
    catch (e) {
        throw e;
    }
}

function placeStopOrders(balances, stopBuy, pair, buy, stopSell, sell) {
    // get balances again
    const coin1 = pair.substr(0, 4);
    const coin2 = pair.substr(4,4);
    var p = new Promise((resolve, reject) => {
        binance.balance((error, balances) => {
            if (error) {
                reject(error);
                return console.log(error)
            }
            if (balances[coin2].available > 20) {
                console.log("Compra: " + stopBuy);
                binance.order("BUY", pair, ((balances[coin2].available - 0.1) / buy).toFixed(2), buy, {
                    type: "STOP_LOSS_LIMIT",
                    stopPrice: stopBuy
                });
            }
            if (balances[coin1].available > 20) {
                console.log("Venda: " + stopSell);
                binance.order("SELL", pair, (balances[coin1].available - 0.1).toFixed(2), sell, {
                    type: "STOP_LOSS_LIMIT",
                    stopPrice: stopSell
                });
            }
            resolve("Done.");
        });
    });
    p.then(() => {
        console.log("Done.");
    });
}

