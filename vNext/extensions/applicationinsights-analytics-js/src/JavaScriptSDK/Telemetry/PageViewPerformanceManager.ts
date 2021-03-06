// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import {
    Util, IPageViewPerformanceTelemetryInternal, DateTimeUtils
} from '@microsoft/applicationinsights-common';
import {
    IAppInsightsCore, IDiagnosticLogger, LoggingSeverity,
    _InternalMessageId
} from '@microsoft/applicationinsights-core-js';

/**
* Class encapsulates sending page view performance telemetry.
*/
export class PageViewPerformanceManager {
    private _logger: IDiagnosticLogger;
    private MAX_DURATION_ALLOWED = 3600000; // 1h

    constructor(core: IAppInsightsCore) {
        if (core) {
            this._logger = core.logger;
        }

    }

    public populatePageViewPerformanceEvent(pageViewPerformance: IPageViewPerformanceTelemetryInternal): void {
        pageViewPerformance.isValid = false;

        /*
         * http://www.w3.org/TR/navigation-timing/#processing-model
         *  |-navigationStart
         *  |             |-connectEnd
         *  |             ||-requestStart
         *  |             ||             |-responseStart
         *  |             ||             |              |-responseEnd
         *  |             ||             |              |
         *  |             ||             |              |         |-loadEventEnd
         *  |---network---||---request---|---response---|---dom---|
         *  |--------------------------total----------------------|
         */
        var timing = this.getPerformanceTiming();
        if (timing) {
            var total = DateTimeUtils.GetDuration(timing.navigationStart, timing.loadEventEnd);
            var network = DateTimeUtils.GetDuration(timing.navigationStart, timing.connectEnd);
            var request = DateTimeUtils.GetDuration(timing.requestStart, timing.responseStart);
            var response = DateTimeUtils.GetDuration(timing.responseStart, timing.responseEnd);
            var dom = DateTimeUtils.GetDuration(timing.responseEnd, timing.loadEventEnd);

            if (total == 0) {
                this._logger.throwInternal(
                    LoggingSeverity.WARNING,
                    _InternalMessageId.ErrorPVCalc,
                    "error calculating page view performance.",
                    { total: total, network: network, request: request, response: response, dom: dom });

            } else if (!this.shouldCollectDuration(total, network, request, response, dom)) {
                this._logger.throwInternal(
                    LoggingSeverity.WARNING,
                    _InternalMessageId.InvalidDurationValue,
                    "Invalid page load duration value. Browser perf data won't be sent.",
                    { total: total, network: network, request: request, response: response, dom: dom });

            } else if (total < Math.floor(network) + Math.floor(request) + Math.floor(response) + Math.floor(dom)) {
                // some browsers may report individual components incorrectly so that the sum of the parts will be bigger than total PLT
                // in this case, don't report client performance from this page
                this._logger.throwInternal(
                    LoggingSeverity.WARNING,
                    _InternalMessageId.ClientPerformanceMathError,
                    "client performance math error.",
                    { total: total, network: network, request: request, response: response, dom: dom });

            } else {
                pageViewPerformance.durationMs = total;
                // // convert to timespans
                pageViewPerformance.perfTotal = pageViewPerformance.duration = Util.msToTimeSpan(total);
                pageViewPerformance.networkConnect = Util.msToTimeSpan(network);
                pageViewPerformance.sentRequest = Util.msToTimeSpan(request);
                pageViewPerformance.receivedResponse = Util.msToTimeSpan(response);
                pageViewPerformance.domProcessing = Util.msToTimeSpan(dom);
                pageViewPerformance.isValid = true;
            }
        }
    }

    public getPerformanceTiming(): PerformanceTiming {
        if (this.isPerformanceTimingSupported()) {
            return window.performance.timing;
        }

        return null;
    }

    /**
    * Returns true is window performance timing API is supported, false otherwise.
    */
    public isPerformanceTimingSupported() {
        return typeof window != "undefined" && window.performance && window.performance.timing;
    }

    /**
    * As page loads different parts of performance timing numbers get set. When all of them are set we can report it.
    * Returns true if ready, false otherwise.
    */
    public isPerformanceTimingDataReady() {
        var timing = window.performance.timing;

        return timing.domainLookupStart > 0
            && timing.navigationStart > 0
            && timing.responseStart > 0
            && timing.requestStart > 0
            && timing.loadEventEnd > 0
            && timing.responseEnd > 0
            && timing.connectEnd > 0
            && timing.domLoading > 0;
    }

    /**
    * This method tells if given durations should be excluded from collection.
    */
    public shouldCollectDuration(...durations: number[]): boolean {
        // a full list of Google crawlers user agent strings - https://support.google.com/webmasters/answer/1061943?hl=en
        let botAgentNames = ['googlebot', 'adsbot-google', 'apis-google', 'mediapartners-google'];
        let userAgent = navigator.userAgent;
        let isGoogleBot = false;

        if (userAgent) {
            for (let i = 0; i < botAgentNames.length; i++) {
                isGoogleBot = isGoogleBot || userAgent.toLowerCase().indexOf(botAgentNames[i]) !== -1;
            }
        }

        if (isGoogleBot) {
            // Don't report durations for GoogleBot, it is returning invalid values in performance.timing API.
            return false;
        } else {
            // for other page views, don't report if it's outside of a reasonable range
            for (var i = 0; i < durations.length; i++) {
                if (durations[i] >= this.MAX_DURATION_ALLOWED) {
                    return false;
                }
            }
        }

        return true;
    }


}
