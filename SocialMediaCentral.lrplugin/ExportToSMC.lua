local LrApplication = import 'LrApplication'
local LrHttp = import 'LrHttp'
local LrDialogs = import 'LrDialogs'
local LrPathUtils = import 'LrPathUtils'

local exportFilterProvider = {}

exportFilterProvider.exportPresetFields = {
    { key = 'enabled', default = true }
}

function exportFilterProvider.sectionForFilterInDialog( f, propertyTable )
    return {
        title = "Social Media Central",
        f:row {
            f:static_text {
                title = "Images and metadata will be sent to the SMC app after export."
            }
        }
    }
end

function exportFilterProvider.postProcessRenderedPhotos(functionContext, filterContext)
    local desktop = LrPathUtils.getStandardFilePath('desktop')
    local logFile = LrPathUtils.child(desktop, "SMC_Debug_Log.txt")
    
    local function log(msg)
        local f = io.open(logFile, "a")
        if f then
            f:write(tostring(msg) .. "\n")
            f:close()
        end
    end

    log("============================")
    log("--- SMC EXPORT TRIGGERED ---")

    local imagePaths = {}
    local metadata = {}
    local firstPhoto = false

    -- We loop through the exported photos. NO pcall wrapper here because waitForRender must yield.
    for sourceRendition, renditionToSatisfy in filterContext:renditions{ plugin = _PLUGIN } do
        log("1. Waiting for Lightroom to render photo...")
        local success, pathOrMessage = sourceRendition:waitForRender()
        log("2. Render finished. Success: " .. tostring(success))
        
        if success then
            table.insert(imagePaths, pathOrMessage)

            if not firstPhoto then
                local photo = sourceRendition.photo
                if photo then
                    log("3. Extracting metadata...")
                    
                    -- It IS safe to use pcall here because getting metadata is instant (does not yield)
                    local function getMeta(key)
                        local s, val = pcall(function() return photo:getFormattedMetadata(key) end)
                        if s and val then return tostring(val) else return "" end
                    end
                    
                    metadata = {
                        title = getMeta('title'),
                        caption = getMeta('caption'),
                        keywords = getMeta('keywordTagsForExport'),
                        location = getMeta('location'),
                        camera = getMeta('cameraModel'),
                        lens = getMeta('lens'),
                        aperture = getMeta('aperture'),
                        iso = getMeta('isoSpeedRating')
                    }
                    firstPhoto = true
                    log("4. Metadata extracted.")
                end
            end
        end
    end

    log("5. Total images ready to send: " .. tostring(#imagePaths))

    if #imagePaths > 0 then
        local function escape(s)
            if not s then return "" end
            s = tostring(s)
            s = string.gsub(s, "\\", "\\\\")
            s = string.gsub(s, '"', '\\"')
            s = string.gsub(s, "\n", "\\n")
            s = string.gsub(s, "\r", "\\r")
            return s
        end

        local keywordsJson = "[]"
        if metadata.keywords and metadata.keywords ~= "" then
            local kwArray = {}
            for kw in string.gmatch(metadata.keywords, "[^,]+") do
                kw = string.match(kw, "^%s*(.-)%s*$")
                table.insert(kwArray, '"' .. escape(kw) .. '"')
            end
            keywordsJson = "[" .. table.concat(kwArray, ", ") .. "]"
        end

        local pathsJson = "["
        for i, p in ipairs(imagePaths) do
            pathsJson = pathsJson .. '"' .. escape(p) .. '"'
            if i < #imagePaths then pathsJson = pathsJson .. ", " end
        end
        pathsJson = pathsJson .. "]"

        local payload = '{' ..
            '"imagePaths": ' .. pathsJson .. ',' ..
            '"metadata": {' ..
                '"title": "' .. escape(metadata.title) .. '",' ..
                '"caption": "' .. escape(metadata.caption) .. '",' ..
                '"keywords": ' .. keywordsJson .. ',' ..
                '"location": "' .. escape(metadata.location) .. '",' ..
                '"camera": "' .. escape(metadata.camera) .. '",' ..
                '"lens": "' .. escape(metadata.lens) .. '",' ..
                '"aperture": "' .. escape(metadata.aperture) .. '",' ..
                '"iso": "' .. escape(metadata.iso) .. '"' ..
            '}' ..
        '}'

        log("6. Payload successfully built. Attempting HTTP POST to Electron...")

        local headers = { { field = 'Content-Type', value = 'application/json' } }
        local response, respHeaders = LrHttp.post('http://127.0.0.1:49152/lightroom-export', payload, headers)
        
        log("7. HTTP POST complete. Response from SMC: " .. tostring(response))
        
        if response then
            LrDialogs.message("Success", "Sent to Social Media Central!", "info")
        else
            LrDialogs.message("Connection Failed", "Could not reach Social Media Central. Is the app open?", "critical")
        end
    end
    
    log("--- SMC EXPORT FINISHED ---")
    log("============================")
end

return exportFilterProvider
