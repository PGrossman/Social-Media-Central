local LrApplication = import 'LrApplication'
local LrHttp = import 'LrHttp'
local LrDialogs = import 'LrDialogs'
local LrTasks = import 'LrTasks'
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
    local catalog = LrApplication.activeCatalog()

    for sourceRendition, renditionToSatisfy in filterContext:renditions{ plugin = _PLUGIN } do
        
        -- Extract Metadata BEFORE rendering, inside a strict Catalog Read Access block
        if not firstPhoto then
            local photo = sourceRendition.photo
            if photo then
                log("1. Requesting Catalog Read Access...")
                
                catalog:withReadAccessDo("SMC_Metadata_Extraction", function()
                    local function getMeta(key)
                        local s, val = pcall(function() return photo:getFormattedMetadata(key) end)
                        if not s then 
                            log("META ERROR for [" .. key .. "]: " .. tostring(val)) 
                        end
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
                end)
                firstPhoto = true
                log("2. Metadata extraction finished.")
            end
        end

        log("3. Waiting for Lightroom to render JPG...")
        local success, pathOrMessage = sourceRendition:waitForRender()
        
        if success then
            table.insert(imagePaths, pathOrMessage)
            log("4. Successfully rendered: " .. tostring(pathOrMessage))
        end
    end

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

        local headers = { { field = 'Content-Type', value = 'application/json' } }
        
        log("5. Attempting initial HTTP POST to SMC app...")
        local response, respHeaders = LrHttp.post('http://127.0.0.1:49152/lightroom-export', payload, headers)
        
        if not response then
            log("6. Initial POST failed. App is likely closed. Attempting auto-launch...")
            
            if MAC_ENV then
                LrTasks.execute('open -a "Social Media Central"')
                log("7. Mac app launch triggered. Yielding thread for 4 seconds...")
                LrTasks.sleep(4) -- Graceful yield, does not freeze the UI
            elseif WIN_ENV then
                LrTasks.execute('start "" "Social Media Central"')
                LrTasks.sleep(4)
            end
            
            log("8. 4 seconds elapsed. Retrying HTTP POST...")
            response, respHeaders = LrHttp.post('http://127.0.0.1:49152/lightroom-export', payload, headers)
        end
        
        if response then
            log("9. Success! Data received by SMC app.")
        else
            log("9. FAILED. App could not be reached even after auto-launch.")
            LrDialogs.message("Connection Failed", "Could not reach Social Media Central. Ensure the app is installed in your Applications folder.", "critical")
        end
    end
    
    log("--- SMC EXPORT FINISHED ---")
end

return exportFilterProvider
