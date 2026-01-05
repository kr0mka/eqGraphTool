/**
 * Interactive EQ Module
 * Provides draggable filter handles for visual EQ adjustment on frequency response graphs.
 *
 * Usage:
 *   InteractiveEQ.init({ scales, svg, geometry, callbacks, Equalizer });
 *   InteractiveEQ.enable();
 *   InteractiveEQ.disable();
 *   InteractiveEQ.updateHandles();
 *   InteractiveEQ.transitionHandles(duration);
 */
const InteractiveEQ = (function() {
    'use strict';

    // ===========================================
    // Module State
    // ===========================================
    let initialized = false;
    let enabled = false;
    let isDragging = false;
    let wasDragged = false;
    let pendingFrame = null;
    let blockFocus = false;
    let scrollLockStyle = null;
    let justDeletedFilter = false;
    let hoveredHandle = null;
    let hoveredHandleData = null;

    // Injected dependencies
    let scales = null;      // { x, y }
    let svg = null;         // { gr, gpath, line }
    let geometry = null;    // { pad, W, H }
    let callbacks = null;   // { getActivePhones, getBaseline, ... }
    let Equalizer = null;

    // SVG elements created by this module
    let eqHandlesGroup = null;
    let qTooltip = null;
    let interactRect = null;
    let svgEl = null;

    // ===========================================
    // Constants
    // ===========================================
    const handleColors = ["#e74c3c","#3498db","#2ecc71","#f39c12","#9b59b6","#1abc9c","#e67e22","#34495e","#e91e63","#00bcd4"];

    function getFilterColor(i) { return handleColors[i % handleColors.length]; }
    function getTypeLabel(t) { return t === "LSQ" ? "L" : t === "HSQ" ? "H" : "P"; }

    function qToRadius(q) {
        let minR = 12, maxR = 28;
        let logQ = Math.log10(Math.max(0.1, Math.min(10, q || 1)));
        let ratio = (logQ + 1) / 2;
        return maxR - ratio * (maxR - minR);
    }

    // ===========================================
    // Q Tooltip
    // ===========================================
    function createQTooltip() {
        qTooltip = svg.gr.append("g").attr("class", "q-tooltip").style("opacity", 0).style("pointer-events", "none");
        qTooltip.append("rect").attr("rx", 3).attr("ry", 3).attr("fill", "var(--background-color, #222)").attr("stroke-width", 1.5);
        qTooltip.append("text").attr("font-size", "9px").attr("font-family", "var(--font-secondary, sans-serif)").attr("text-anchor", "middle").attr("dominant-baseline", "central");
    }

    function showQTooltip(handleX, handleY, qValue, color) {
        let text = qTooltip.select("text").text(qValue.toFixed(2)).attr("fill", color);
        let bbox = text.node().getBBox();
        let padX = 4, padY = 2;
        qTooltip.select("rect")
            .attr("x", -bbox.width/2 - padX)
            .attr("y", -bbox.height/2 - padY)
            .attr("width", bbox.width + padX*2)
            .attr("height", bbox.height + padY*2)
            .attr("stroke", color);
        qTooltip.attr("transform", `translate(${handleX},${handleY - 38})`).style("opacity", 1);
        qTooltip.raise();
    }

    function hideQTooltip() {
        qTooltip.style("opacity", 0);
    }

    function updateQTooltipForHover() {
        if (!hoveredHandle || !hoveredHandleData) {
            hideQTooltip();
            return;
        }
        let transform = hoveredHandle.attr("transform");
        let match = transform && transform.match(/translate\(([^,]+),([^)]+)\)/);
        if (match) {
            let filterInputs = callbacks.getFilterInputs();
            let q = parseFloat(filterInputs.q[hoveredHandleData.filterIndex].value) || 1;
            let color = getFilterColor(hoveredHandleData.filterIndex);
            showQTooltip(parseFloat(match[1]), parseFloat(match[2]), q, color);
        }
    }

    // ===========================================
    // Phone/Curve Sampling
    // ===========================================
    function getEQPhoneObj() {
        let eqPhoneSelect = callbacks.getEQPhoneSelect();
        let sel = eqPhoneSelect.value;
        let activePhones = callbacks.getActivePhones();
        return sel && activePhones.find(p => !p.isPrefBounds && p.brand.name + " " + p.dispName == sel);
    }

    function samplePhoneCurveAt(phoneObj, freq) {
        if (!phoneObj) return null;

        let curveData = null;
        let offset = callbacks.getOffset(phoneObj);
        let baseline = callbacks.getBaseline();

        if (phoneObj.activeCurves && phoneObj.activeCurves[0]) {
            let curve = phoneObj.activeCurves[0];
            curveData = curve.l || curve;
        }
        if (!curveData && phoneObj.rawChannels && phoneObj.rawChannels[0]) {
            curveData = phoneObj.rawChannels[0];
        }
        if (!curveData || !Array.isArray(curveData)) return null;

        let data = baseline.fn(curveData);
        let idx = data.findIndex(d => d[0] >= freq);
        if (idx < 0) idx = data.length - 1;
        if (idx === 0) return data[0][1] + offset;

        let p1 = data[idx - 1], p2 = data[idx];
        let t = (freq - p1[0]) / (p2[0] - p1[0]);
        return p1[1] + t * (p2[1] - p1[1]) + offset;
    }

    // ===========================================
    // EQ Preview
    // ===========================================
    function updateEQPreview() {
        let phoneObj = getEQPhoneObj();
        if (!phoneObj || !phoneObj.eq || !phoneObj.eq.activeCurves || !phoneObj.eq.activeCurves[0]) {
            return;
        }

        let filters = callbacks.getFilters();
        if (!filters.length) return;

        let rawChannels = phoneObj.rawChannels;
        if (!rawChannels || !rawChannels.length) return;

        let eqChannels = rawChannels.map(c => c ? Equalizer.apply(c, filters) : null);

        let smoothedChannels = eqChannels.map(c =>
            c ? callbacks.smooth(c.map(d => d[1]), c).map((d, i) => [c[i][0], d]) : null
        );
        let validChannels = smoothedChannels.filter(c => c !== null);

        let previewData;
        if (validChannels.length > 1 && phoneObj.avg) {
            previewData = callbacks.avgCurves(validChannels);
        } else if (validChannels.length > 0) {
            previewData = validChannels[0];
        } else {
            return;
        }

        let baseline = callbacks.getBaseline();
        let transformedData = baseline.fn(previewData);

        let eqCurve = phoneObj.eq.activeCurves[0];
        let eqPath = svg.gpath.selectAll("path").filter(function(d) {
            return d && d.id === eqCurve.id;
        });

        if (!eqPath.empty()) {
            eqPath.attr("d", svg.line(transformedData));
        }
    }

    // ===========================================
    // Handle Drag Interactions
    // ===========================================
    function bindHandleEvents(sel) {
        let filterInputs = callbacks.getFilterInputs();

        function startDrag(d, element, clientX, clientY) {
            if (!enabled) return;

            let handle = d3.select(element);
            let filterIndex = d.filterIndex;
            let startX = clientX, startY = clientY;
            let moved = false;
            isDragging = true;
            wasDragged = false;
            blockFocus = true;
            var savedScrollY = window.scrollY || window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0;
            var savedScrollX = window.scrollX || window.pageXOffset || document.documentElement.scrollLeft || document.body.scrollLeft || 0;

            function onMove(e) {
                e.preventDefault();
                let cx, cy;
                if (e.touches && e.touches.length > 0) {
                    cx = e.touches[0].clientX;
                    cy = e.touches[0].clientY;
                } else {
                    cx = e.clientX;
                    cy = e.clientY;
                }

                let dist = Math.hypot(cx - startX, cy - startY);
                if (!moved && dist < 5) return;
                moved = true;
                wasDragged = true;

                if (pendingFrame) return;
                pendingFrame = requestAnimationFrame(() => {
                    pendingFrame = null;
                    let svgNode = svg.gr.node().ownerSVGElement || svg.gr.node();
                    let pt = svgNode.createSVGPoint();
                    pt.x = cx; pt.y = cy;
                    let svgPt = pt.matrixTransform(svg.gr.node().getScreenCTM().inverse());

                    let newFreq = Math.round(scales.x.invert(svgPt.x));
                    newFreq = Math.max(20, Math.min(20000, newFreq));

                    let targetY = scales.y.invert(svgPt.y);
                    let phoneObj = getEQPhoneObj();
                    let curveY = samplePhoneCurveAt(phoneObj, newFreq);

                    let newGain;
                    if (curveY !== null) {
                        newGain = targetY - curveY;
                    } else {
                        let yd = scales.y.domain();
                        let center = (yd[0] + yd[1]) / 2;
                        newGain = targetY - center;
                    }
                    newGain = Math.round(newGain * 10) / 10;
                    newGain = Math.max(-40, Math.min(40, newGain));

                    filterInputs = callbacks.getFilterInputs();
                    if (filterInputs.freq[filterIndex]) filterInputs.freq[filterIndex].value = newFreq;
                    if (filterInputs.gain[filterIndex]) filterInputs.gain[filterIndex].value = newGain;

                    let px = scales.x(newFreq);
                    let py = scales.y(targetY);
                    handle.attr("transform", `translate(${px},${py})`);

                    updateEQPreview();
                });
            }

            function onUp(e) {
                if (e) e.preventDefault();
                document.removeEventListener("mousemove", onMove);
                document.removeEventListener("mouseup", onUp);
                document.removeEventListener("touchmove", onMove);
                document.removeEventListener("touchend", onUp);
                let restoreScroll = () => {
                    window.scrollTo(savedScrollX, savedScrollY);
                    document.documentElement.scrollTop = savedScrollY;
                    document.body.scrollTop = savedScrollY;
                };
                if (moved) {
                    callbacks.applyEQ();
                }
                if (document.activeElement) document.activeElement.blur();
                restoreScroll();
                requestAnimationFrame(restoreScroll);
                setTimeout(restoreScroll, 0);
                setTimeout(restoreScroll, 50);
                setTimeout(restoreScroll, 100);
                setTimeout(() => {
                    isDragging = false;
                    blockFocus = false;
                }, 120);
            }

            document.addEventListener("mousemove", onMove);
            document.addEventListener("mouseup", onUp);
            document.addEventListener("touchmove", onMove, { passive: false });
            document.addEventListener("touchend", onUp, { passive: false });
        }

        // Double-tap detection for mobile
        let lastTapTime = 0;
        let lastTapElement = null;

        function cycleFilterType(d) {
            if (!enabled) return;
            let idx = d.filterIndex;
            filterInputs = callbacks.getFilterInputs();
            const types = ["PK", "LSQ", "HSQ"];
            let cur = types.indexOf(filterInputs.type[idx].value);
            filterInputs.type[idx].value = types[(cur + 1) % 3];
            callbacks.applyEQ();
        }

        sel.on("mousedown", function(d) {
            d3.event.preventDefault();
            d3.event.stopPropagation();
            startDrag(d, this, d3.event.clientX, d3.event.clientY);
        })
        .on("touchstart", function(d) {
            d3.event.preventDefault();
            d3.event.stopPropagation();
            let now = Date.now();
            let element = this;
            if (d3.event.touches && d3.event.touches.length > 0) {
                if (lastTapElement === element && now - lastTapTime < 300) {
                    cycleFilterType(d);
                    lastTapTime = 0;
                    lastTapElement = null;
                } else {
                    lastTapTime = now;
                    lastTapElement = element;
                    startDrag(d, this, d3.event.touches[0].clientX, d3.event.touches[0].clientY);
                }
            }
        })
        .on("dblclick", function(d) {
            cycleFilterType(d);
            d3.event.preventDefault();
            d3.event.stopPropagation();
        })
        .on("wheel", function(d) {
            if (!enabled) return;
            d3.event.preventDefault();
            d3.event.stopPropagation();
            let idx = d.filterIndex;
            filterInputs = callbacks.getFilterInputs();
            let q = parseFloat(filterInputs.q[idx].value) || 1;
            let step = d3.event.shiftKey ? 0.01 : 0.1;
            let precision = d3.event.shiftKey ? 100 : 10;
            q += d3.event.deltaY < 0 ? step : -step;
            q = Math.max(0.1, Math.min(10, Math.round(q * precision) / precision));
            filterInputs.q[idx].value = q;
            callbacks.applyEQ();
        })
        .on("click", function() {
            d3.event.preventDefault();
            d3.event.stopPropagation();
        });
    }

    // ===========================================
    // Handle Management
    // ===========================================
    function transitionEQHandles(duration) {
        if (!enabled) return;
        let phoneObj = getEQPhoneObj();
        eqHandlesGroup.selectAll(".eq-handle")
            .transition().duration(duration).ease(d3.easeQuad)
            .attr("transform", d => {
                let px = scales.x(Math.max(20, Math.min(20000, d.freq)));
                let curveY = samplePhoneCurveAt(phoneObj, d.freq);
                let py = curveY !== null ? scales.y(curveY + (d.gain || 0)) : scales.y(scales.y.domain().reduce((a,b)=>a+b)/2 + (d.gain||0));
                return `translate(${px},${py})`;
            });
    }

    function updateEQHandles() {
        if (!enabled) {
            eqHandlesGroup.selectAll(".eq-handle").remove();
            return;
        }

        let phoneObj = getEQPhoneObj();
        let filters = callbacks.getFilters()
            .map((f, i) => ({ ...f, filterIndex: i }))
            .filter(f => f.freq && f.freq > 0);

        let handles = eqHandlesGroup.selectAll(".eq-handle").data(filters, d => d.filterIndex);
        handles.exit().remove();

        let enter = handles.enter().append("g").attr("class", "eq-handle")
            .style("touch-action", "none").call(bindHandleEvents);

        // Whisker line behind ring
        enter.append("line").attr("class", "whisker").attr("stroke-width", 1.5).attr("opacity", 0);
        // Ring circles
        enter.append("circle").attr("class", "outer");
        enter.append("circle").attr("class", "inner").attr("r", 10);
        // Whisker end balls on top of ring
        enter.append("circle").attr("class", "whisker-left").attr("r", 4).attr("opacity", 0)
            .style("cursor", "ew-resize").style("touch-action", "none").style("pointer-events", "all");
        enter.append("circle").attr("class", "whisker-right").attr("r", 4).attr("opacity", 0)
            .style("cursor", "ew-resize").style("touch-action", "none").style("pointer-events", "all");
        // Label on top
        enter.append("text").attr("class", "type-label")
            .attr("text-anchor", "middle").attr("dominant-baseline", "central")
            .attr("font-size", "12px").attr("font-weight", "bold").attr("pointer-events", "none");
        // Delete X button
        let deleteBtn = enter.append("g").attr("class", "delete-btn").attr("opacity", 0)
            .attr("transform", "translate(0, 19)")
            .style("cursor", "pointer").style("pointer-events", "all");
        deleteBtn.append("circle").attr("r", 7).attr("fill", "var(--background-color, #222)")
            .attr("class", "delete-border").attr("stroke-width", 1.5);
        deleteBtn.append("line").attr("x1", -3).attr("y1", -3).attr("x2", 3).attr("y2", 3)
            .attr("class", "delete-x").attr("stroke", "#f08080").attr("stroke-width", 1.5);
        deleteBtn.append("line").attr("x1", 3).attr("y1", -3).attr("x2", -3).attr("y2", 3)
            .attr("class", "delete-x").attr("stroke", "#f08080").attr("stroke-width", 1.5);

        // Desktop whisker fade timers
        let whiskerFadeTimers = new Map();

        function startWhiskerFadeTimer(handle) {
            let key = handle.node();
            if (whiskerFadeTimers.has(key)) {
                clearTimeout(whiskerFadeTimers.get(key));
            }
            whiskerFadeTimers.set(key, setTimeout(() => {
                if (hoveredHandle === null || hoveredHandle.node() !== key) {
                    handle.classed("whisker-selected", false);
                    handle.selectAll(".whisker, .whisker-left, .whisker-right, .delete-btn")
                        .transition().duration(300).attr("opacity", 0);
                }
                whiskerFadeTimers.delete(key);
            }, 2000));
        }

        function cancelWhiskerFadeTimer(handle) {
            let key = handle.node();
            if (whiskerFadeTimers.has(key)) {
                clearTimeout(whiskerFadeTimers.get(key));
                whiskerFadeTimers.delete(key);
            }
        }

        // Track hover for Q tooltip
        enter.on("mouseenter", function() {
            let h = d3.select(this);
            cancelWhiskerFadeTimer(h);
            hoveredHandle = h;
            hoveredHandleData = h.datum();
            if (d3.event && d3.event.shiftKey) {
                updateQTooltipForHover();
            }
        }).on("mouseleave", function() {
            let h = d3.select(this);
            if (h.classed("whisker-selected")) {
                startWhiskerFadeTimer(h);
            }
            hoveredHandle = null;
            hoveredHandleData = null;
            hideQTooltip();
        });

        // Desktop: Single-click to toggle whiskers
        let clickTimer = null;
        enter.on("click.whisker", function() {
            if (wasDragged) { wasDragged = false; return; }
            let h = d3.select(this);
            if (clickTimer) clearTimeout(clickTimer);
            clickTimer = setTimeout(() => {
                clickTimer = null;
                let wasSelected = h.classed("whisker-selected");
                if (wasSelected) {
                    h.classed("whisker-selected", false);
                    h.selectAll(".whisker, .whisker-left, .whisker-right, .delete-btn")
                        .transition().duration(300).attr("opacity", 0);
                    cancelWhiskerFadeTimer(h);
                } else {
                    h.classed("whisker-selected", true);
                    h.selectAll(".whisker, .whisker-left, .whisker-right").attr("opacity", 0.8);
                    h.select(".delete-btn").attr("opacity", 1);
                    cancelWhiskerFadeTimer(h);
                }
            }, 250);
        }).on("dblclick.whisker", function() {
            if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
        });

        // Delete button handler
        function deleteFilter(d) {
            justDeletedFilter = true;
            setTimeout(() => { justDeletedFilter = false; }, 100);

            let idx = d.filterIndex;
            let filters = callbacks.getFilters();
            filters.splice(idx, 1);
            callbacks.setBands(Math.max(callbacks.getBands() - 1, 1));
            callbacks.updateFilterElements();
            callbacks.setFilters(filters);
            callbacks.applyEQ();
            callbacks.updatePreampDisplay();
        }

        enter.select(".delete-btn").on("touchstart", function() {
            if (d3.event.sourceEvent) {
                d3.event.sourceEvent.stopPropagation();
            }
            d3.event.stopPropagation();
        }).on("click", function(d) {
            d3.event.stopPropagation();
            deleteFilter(d);
        }).on("touchend", function(d) {
            d3.event.preventDefault();
            d3.event.stopPropagation();
            if (d3.event.sourceEvent) {
                d3.event.sourceEvent.stopPropagation();
                d3.event.sourceEvent.stopImmediatePropagation();
            }
            deleteFilter(d);
        });

        // Mobile: Long press to toggle whiskers
        let longPressTimer = null;
        let longPressStartPos = null;
        let mobileWhiskerTimeout = null;

        function startMobileWhiskerTimeout(handle) {
            if (mobileWhiskerTimeout) clearTimeout(mobileWhiskerTimeout);
            mobileWhiskerTimeout = setTimeout(() => {
                mobileWhiskerTimeout = null;
                handle.classed("whisker-selected", false);
                handle.selectAll(".whisker, .whisker-left, .whisker-right, .delete-btn")
                    .transition().duration(300).attr("opacity", 0);
            }, 3000);
        }

        function cancelMobileWhiskerTimeout() {
            if (mobileWhiskerTimeout) {
                clearTimeout(mobileWhiskerTimeout);
                mobileWhiskerTimeout = null;
            }
        }

        enter.on("touchstart.whisker", function() {
            let element = this;
            if (d3.event.touches && d3.event.touches.length > 0) {
                longPressStartPos = {
                    x: d3.event.touches[0].clientX,
                    y: d3.event.touches[0].clientY
                };
            }
            cancelMobileWhiskerTimeout();
            longPressTimer = setTimeout(() => {
                longPressTimer = null;
                let h = d3.select(element);
                let wasSelected = h.classed("whisker-selected");
                eqHandlesGroup.selectAll(".eq-handle").classed("whisker-selected", false)
                    .selectAll(".whisker, .whisker-left, .whisker-right, .delete-btn").attr("opacity", 0);
                if (!wasSelected) {
                    h.classed("whisker-selected", true);
                    h.selectAll(".whisker, .whisker-left, .whisker-right").attr("opacity", 0.8);
                    h.select(".delete-btn").attr("opacity", 1);
                    startMobileWhiskerTimeout(h);
                }
            }, 500);
        }).on("touchmove.whisker", function() {
            if (longPressTimer && d3.event.touches && d3.event.touches.length > 0 && longPressStartPos) {
                let dx = Math.abs(d3.event.touches[0].clientX - longPressStartPos.x);
                let dy = Math.abs(d3.event.touches[0].clientY - longPressStartPos.y);
                if (dx > 3 || dy > 3) {
                    clearTimeout(longPressTimer);
                    longPressTimer = null;
                }
            }
        }).on("touchend.whisker", function() {
            if (longPressTimer) {
                clearTimeout(longPressTimer);
                longPressTimer = null;
            }
            longPressStartPos = null;
            let h = d3.select(this);
            if (h.classed("whisker-selected")) {
                startMobileWhiskerTimeout(h);
            }
        });

        // Whisker drag to adjust Q
        function whiskerDrag(side) {
            return d3.drag()
                .on("start", function() {
                    d3.event.sourceEvent.stopPropagation();
                    cancelMobileWhiskerTimeout();
                    let handle = d3.select(this.parentNode);
                    cancelWhiskerFadeTimer(handle);
                })
                .on("drag", function(d) {
                    let handle = d3.select(this.parentNode);
                    let freq = d.freq || 1000;
                    let pxCenter = scales.x(freq);

                    let mouseX = d3.event.x + pxCenter;
                    let newFreqEdge = scales.x.invert(mouseX);
                    newFreqEdge = Math.max(20, Math.min(20000, newFreqEdge));

                    let fLow, fHigh;
                    if (side === "left") {
                        fLow = newFreqEdge;
                        fHigh = freq * freq / fLow;
                    } else {
                        fHigh = newFreqEdge;
                        fLow = freq * freq / fHigh;
                    }

                    if (fHigh <= fLow || fLow <= 0) return;

                    let bwOctaves = Math.log2(fHigh / fLow);
                    if (bwOctaves <= 0) return;

                    let newQ = 1 / (2 * Math.sinh(bwOctaves * Math.LN2 / 2));
                    newQ = Math.max(0.1, Math.min(10, Math.round(newQ * 100) / 100));

                    let idx = d.filterIndex;
                    let filterInputs = callbacks.getFilterInputs();
                    filterInputs.q[idx].value = newQ;

                    d.q = newQ;
                    let newBwOctaves = 2 * Math.asinh(1 / (2 * newQ)) / Math.LN2;
                    let newFLow = freq / Math.pow(2, newBwOctaves / 2);
                    let newFHigh = freq * Math.pow(2, newBwOctaves / 2);
                    let pxLow = scales.x(Math.max(20, newFLow)) - pxCenter;
                    let pxHigh = scales.x(Math.min(20000, newFHigh)) - pxCenter;

                    handle.select("line.whisker").attr("x1", pxLow).attr("x2", pxHigh);
                    handle.select("circle.whisker-left").attr("cx", pxLow);
                    handle.select("circle.whisker-right").attr("cx", pxHigh);
                    handle.select("circle.outer").attr("r", qToRadius(newQ));

                    updateEQPreview();

                    let transform = handle.attr("transform");
                    let match = transform && transform.match(/translate\(([^,]+),([^)]+)\)/);
                    if (match) {
                        let color = getFilterColor(d.filterIndex);
                        showQTooltip(parseFloat(match[1]), parseFloat(match[2]), newQ, color);
                    }
                })
                .on("end", function(d) {
                    hideQTooltip();
                    let scrollX = window.scrollX, scrollY = window.scrollY;
                    let restoreScroll = () => window.scrollTo(scrollX, scrollY);
                    callbacks.applyEQ();
                    if (document.activeElement) document.activeElement.blur();
                    restoreScroll();
                    requestAnimationFrame(restoreScroll);
                    setTimeout(restoreScroll, 0);
                    setTimeout(restoreScroll, 50);
                    setTimeout(restoreScroll, 100);
                    let handle = d3.select(this.parentNode);
                    if (handle.classed("whisker-selected")) {
                        startMobileWhiskerTimeout(handle);
                        startWhiskerFadeTimer(handle);
                    }
                });
        }

        enter.select(".whisker-left").call(whiskerDrag("left"));
        enter.select(".whisker-right").call(whiskerDrag("right"));

        let all = enter.merge(handles);
        all.attr("transform", d => {
            let px = scales.x(Math.max(20, Math.min(20000, d.freq)));
            let curveY = samplePhoneCurveAt(phoneObj, d.freq);
            let py = curveY !== null ? scales.y(curveY + (d.gain || 0)) : scales.y(scales.y.domain().reduce((a,b)=>a+b)/2 + (d.gain||0));
            return `translate(${px},${py})`;
        }).classed("disabled", d => d.disabled);

        all.each(function(d) {
            let col = getFilterColor(d.filterIndex);
            let r = qToRadius(d.q);
            let h = d3.select(this);
            h.select("circle.outer").attr("r", r).attr("stroke", col).attr("fill", col);
            h.select("circle.inner").attr("stroke", col).attr("fill", col);
            h.select("text.type-label").text(getTypeLabel(d.type)).attr("fill", "#fff");

            let q = d.q || 1;
            let freq = d.freq || 1000;
            let bwOctaves = 2 * Math.asinh(1 / (2 * q)) / Math.LN2;
            let fLow = freq / Math.pow(2, bwOctaves / 2);
            let fHigh = freq * Math.pow(2, bwOctaves / 2);

            let pxCenter = scales.x(freq);
            let pxLow = scales.x(Math.max(20, fLow)) - pxCenter;
            let pxHigh = scales.x(Math.min(20000, fHigh)) - pxCenter;

            h.select("line.whisker")
                .attr("x1", pxLow).attr("y1", 0)
                .attr("x2", pxHigh).attr("y2", 0)
                .attr("stroke", col);
            h.select("circle.whisker-left")
                .attr("cx", pxLow).attr("cy", 0)
                .attr("fill", col).attr("stroke", "none");
            h.select("circle.whisker-right")
                .attr("cx", pxHigh).attr("cy", 0)
                .attr("fill", col).attr("stroke", "none");

            h.select(".delete-btn circle.delete-border").attr("stroke", col);
        });
    }

    // ===========================================
    // Graph Click to Create Filter
    // ===========================================
    function handleGraphClick(clientX, clientY) {
        if (!enabled || isDragging || justDeletedFilter) return;

        let svgNode = svg.gr.node().ownerSVGElement || svg.gr.node();
        let pt = svgNode.createSVGPoint();
        pt.x = clientX; pt.y = clientY;
        let svgPt = pt.matrixTransform(svg.gr.node().getScreenCTM().inverse());

        if (svgPt.x < geometry.pad.l || svgPt.x > geometry.pad.l + geometry.W ||
            svgPt.y < geometry.pad.t || svgPt.y > geometry.pad.t + geometry.H) return;

        let freq = Math.max(20, Math.min(20000, Math.round(scales.x.invert(svgPt.x))));
        let targetY = scales.y.invert(svgPt.y);

        let eqPhoneSelect = callbacks.getEQPhoneSelect();
        if (!eqPhoneSelect.value) {
            let firstPhone = eqPhoneSelect.querySelectorAll("option")[1];
            if (firstPhone) {
                eqPhoneSelect.value = firstPhone.value;
            }
        }
        let phoneObj = getEQPhoneObj();
        let curveY = samplePhoneCurveAt(phoneObj, freq);

        let gain;
        if (curveY !== null) {
            gain = targetY - curveY;
        } else {
            let yd = scales.y.domain();
            let center = (yd[0] + yd[1]) / 2;
            gain = targetY - center;
        }
        gain = Math.round(gain * 10) / 10;
        gain = Math.max(-40, Math.min(40, gain));

        let filters = callbacks.getFilters();
        let idx = filters.findIndex(f => !f.freq || f.freq === 0);
        if (idx === -1) {
            let bands = callbacks.getBands();
            let bandsMax = callbacks.getBandsMax();
            if (bands < bandsMax) {
                callbacks.setBands(bands + 1);
                callbacks.updateFilterElements();
                idx = bands;
            } else {
                return;
            }
        }

        let filterInputs = callbacks.getFilterInputs();
        filterInputs.enabled[idx].checked = true;
        filterInputs.type[idx].value = "PK";
        filterInputs.freq[idx].value = freq;
        filterInputs.gain[idx].value = gain;
        filterInputs.q[idx].value = 1.0;
        callbacks.applyEQ();
        updateEQHandles();
    }

    // ===========================================
    // Scroll Lock
    // ===========================================
    function isMobileLandscape() {
        return window.innerHeight <= 500 && window.innerWidth / window.innerHeight >= 1.5;
    }

    function lockBodyScroll() {
        if (scrollLockStyle) return;
        if (isMobileLandscape()) {
            scrollLockStyle = { skipManipulation: true };
            return;
        }
        let scrollY = window.scrollY;
        scrollLockStyle = {
            position: document.body.style.position,
            top: document.body.style.top,
            left: document.body.style.left,
            right: document.body.style.right,
            overflow: document.body.style.overflow,
            scrollY: scrollY
        };
        document.body.style.position = 'fixed';
        document.body.style.top = `-${scrollY}px`;
        document.body.style.left = '0';
        document.body.style.right = '0';
        document.body.style.overflow = 'hidden';
    }

    function unlockBodyScroll() {
        if (!scrollLockStyle) return;
        if (scrollLockStyle.skipManipulation) {
            scrollLockStyle = null;
            return;
        }
        let scrollY = scrollLockStyle.scrollY;
        document.body.style.position = scrollLockStyle.position;
        document.body.style.top = scrollLockStyle.top;
        document.body.style.left = scrollLockStyle.left;
        document.body.style.right = scrollLockStyle.right;
        document.body.style.overflow = scrollLockStyle.overflow;
        window.scrollTo(0, scrollY);
        scrollLockStyle = null;
    }

    function isDeleteButtonTarget(target) {
        while (target && target !== svgEl) {
            if (target.classList && (target.classList.contains('delete-btn') ||
                target.classList.contains('delete-border') ||
                target.classList.contains('delete-x'))) {
                return true;
            }
            target = target.parentNode;
        }
        return false;
    }

    function isEQHandleTarget(target) {
        if (isDeleteButtonTarget(target)) return false;
        while (target && target !== svgEl) {
            if (target.classList && (target.classList.contains('eq-handle') ||
                target.classList.contains('eq-handles') ||
                target.classList.contains('whisker-left') ||
                target.classList.contains('whisker-right') ||
                target.classList.contains('outer') ||
                target.classList.contains('inner'))) {
                return true;
            }
            target = target.parentNode;
        }
        return false;
    }

    function preventScrollOnHandles(e) {
        if (!enabled) return;
        if (isEQHandleTarget(e.target)) {
            e.preventDefault();
            if (e.type === 'touchstart') {
                lockBodyScroll();
            }
        }
    }

    function handleTouchEnd(e) {
        if (!enabled) return;
        if (scrollLockStyle) {
            setTimeout(unlockBodyScroll, 50);
        }
    }

    // ===========================================
    // Enable/Disable
    // ===========================================
    function enable() {
        if (!initialized) return;
        enabled = true;
        callbacks.clearLabels();
        eqHandlesGroup.raise();

        svgEl.addEventListener("touchstart", preventScrollOnHandles, { capture: true, passive: false });
        svgEl.addEventListener("touchmove", preventScrollOnHandles, { capture: true, passive: false });
        document.addEventListener("touchend", handleTouchEnd, { capture: true, passive: false });

        interactRect.on("click.interactive", function() {
            handleGraphClick(d3.event.clientX, d3.event.clientY);
        });

        let touchStartPos = null;
        interactRect.on("touchstart.interactive", function() {
            if (d3.event.touches && d3.event.touches.length > 0) {
                touchStartPos = {
                    x: d3.event.touches[0].clientX,
                    y: d3.event.touches[0].clientY
                };
            }
        });
        interactRect.on("touchend.interactive", function() {
            if (d3.event.changedTouches && d3.event.changedTouches.length > 0 && touchStartPos) {
                let endX = d3.event.changedTouches[0].clientX;
                let endY = d3.event.changedTouches[0].clientY;
                let dx = Math.abs(endX - touchStartPos.x);
                let dy = Math.abs(endY - touchStartPos.y);
                if (dx < 10 && dy < 10) {
                    d3.event.preventDefault();
                    handleGraphClick(endX, endY);
                }
            }
            touchStartPos = null;
        });

        callbacks.updatePaths();
        updateEQHandles();
    }

    function disable() {
        if (!initialized) return;
        enabled = false;

        svgEl.removeEventListener("touchstart", preventScrollOnHandles, { capture: true });
        svgEl.removeEventListener("touchmove", preventScrollOnHandles, { capture: true });
        document.removeEventListener("touchend", handleTouchEnd, { capture: true });
        if (scrollLockStyle) unlockBodyScroll();

        interactRect.on("click.interactive", null);
        interactRect.on("touchstart.interactive", null);
        interactRect.on("touchend.interactive", null);
        eqHandlesGroup.selectAll(".eq-handle").remove();

        let rectEl = svg.gr.select(".graph-interact").node();
        if (rectEl) svg.gr.node().insertBefore(eqHandlesGroup.node(), rectEl);
        callbacks.updatePaths();
    }

    // ===========================================
    // Initialization
    // ===========================================
    function init(options) {
        if (initialized) return publicAPI;

        scales = options.scales;
        svg = options.svg;
        geometry = options.geometry;
        callbacks = options.callbacks;
        Equalizer = options.Equalizer;

        // Create SVG elements
        eqHandlesGroup = svg.gr.insert("g", ".graph-interact").attr("class", "eq-handles")
            .style("touch-action", "none");
        createQTooltip();
        interactRect = svg.gr.select(".graph-interact");
        svgEl = svg.gr.node().ownerSVGElement || svg.gr.node();

        // Setup keyboard listeners for Shift+Q tooltip
        document.addEventListener("keydown", function(e) {
            if (e.key === "Shift" && enabled && hoveredHandle) {
                updateQTooltipForHover();
            }
        });

        document.addEventListener("keyup", function(e) {
            if (e.key === "Shift") {
                hideQTooltip();
            }
        });

        // Prevent focus during EQ interaction
        document.addEventListener('focus', function(e) {
            if (blockFocus && e.target && e.target.tagName &&
                (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) {
                e.target.blur();
                e.preventDefault();
                e.stopPropagation();
            }
        }, true);

        initialized = true;
        return publicAPI;
    }

    // ===========================================
    // Public API
    // ===========================================
    const publicAPI = {
        init: init,
        enable: enable,
        disable: disable,
        updateHandles: updateEQHandles,
        transitionHandles: transitionEQHandles,
        isEnabled: function() { return enabled; },
        destroy: function() {
            if (initialized) {
                disable();
                eqHandlesGroup.remove();
                qTooltip.remove();
                initialized = false;
            }
        }
    };

    return publicAPI;
})();

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = InteractiveEQ;
}
